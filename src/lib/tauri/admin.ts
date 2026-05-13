// src/lib/tauri/admin.ts
//
// Typed wrappers for the Admin cluster — one per registered Rust
// #[tauri::command] across commands.rs (MCP + admin helpers), permissions.rs,
// db_commands.rs (analytics subset), reports.rs, self_upgrade.rs,
// evolution.rs, immune_system.rs, decision_gate.rs, authority_engine.rs,
// audit.rs, security_monitor.rs, symbolic.rs, temporal_intel.rs,
// execution_memory.rs, deep_scan.rs, supervisor.rs, trace.rs, sysadmin.rs,
// integration_bridge.rs, config.rs (provider keys + routing),
// self_critique.rs, tool_forge.rs (D-167 inventory — 22 modules, ~110 cmds).
//
// D-166: per-cluster wrapper module lives HERE (admin cluster only).
// D-167: zero Rust expansion in Phase 7 — every command below is already
//        registered in src-tauri/src/lib.rs generate_handler!.
// D-186: @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-38:  camelCase JS API, snake_case at the invoke boundary.
//        Return types mirror Rust #[derive(Serialize)] shape verbatim.
//
// Some wrappers also exist in config.ts for backward compat with the Phase 1
// onboarding surface. Both wrappers resolve to the same Rust command — no
// double registration; consumers pick the path via the cluster-scoped barrel.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-166..D-191
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §1
// @see src-tauri/src/lib.rs:574-1394 generate_handler!

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// ═══════════════════════════════════════════════════════════════════════════

// ─── MCP types (src-tauri/src/mcp.rs + config.rs) ────────────────────────────

/** @see src-tauri/src/config.rs:36 SavedMcpServerConfig (return shape of mcp_get_servers) */
export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  [k: string]: unknown;
}

/** @see src-tauri/src/mcp.rs:75 McpTool */
export interface McpTool {
  name: string;
  qualified_name: string;
  description: string;
  input_schema: unknown;
  server_name: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/mcp.rs:49 ServerHealth */
export interface McpServerHealth {
  name: string;
  connected: boolean;
  tool_count: number;
  last_call_time?: number | null;
  error_count: number;
  reconnect_attempts: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/mcp.rs:85 McpToolResult */
export interface McpToolResult {
  content: Array<{ type: string; [k: string]: unknown }>;
  is_error: boolean;
  [k: string]: unknown;
}

// ─── Provider / routing types ────────────────────────────────────────────────

/** test_provider returns a free-form String status message. */
export type ProviderTestResult = string;

/** get_all_provider_keys returns a serde_json::Value list descriptor. */
export type ProviderKeyList = unknown;

/** Convenience per-provider key descriptor — matches the runtime shape. */
export interface ProviderKey {
  provider: string;
  has_key?: boolean;
  key_masked?: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/config.rs:16 TaskRouting */
export interface TaskRouting {
  code?: string | null;
  vision?: string | null;
  fast?: string | null;
  creative?: string | null;
  fallback?: string | null;
  [k: string]: unknown;
}

// ─── permissions.rs types ────────────────────────────────────────────────────

/** @see src-tauri/src/permissions.rs:7 ToolRisk — Rust enum (Auto|Ask|Blocked). */
export type ToolRisk = 'Auto' | 'Ask' | 'Blocked';

/** get_tool_overrides returns HashMap<String, ToolRisk> — flat map. */
export type ToolOverride = Record<string, ToolRisk>;

// ─── db_commands.rs (analytics subset) types ─────────────────────────────────

/** @see src-tauri/src/db.rs:46 AnalyticsEvent */
export interface AnalyticsEvent {
  id: number;
  event_type: string;
  timestamp: number;
  metadata?: string | null;
  [k: string]: unknown;
}

/** db_analytics_summary returns a serde_json::Value summary blob. */
export type AnalyticsSummary = Record<string, unknown>;

// ─── reports.rs types ────────────────────────────────────────────────────────

/** @see src-tauri/src/db.rs:564 CapabilityReport */
export interface Report {
  id: string;
  category: string;
  title: string;
  description: string;
  user_request: string;
  blade_response: string;
  suggested_fix: string;
  severity: string;
  status: string;
  reported_at: number;
  [k: string]: unknown;
}

// ─── self_upgrade.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/self_upgrade.rs:24 CapabilityGap */
export interface UpgradeCatalogEntry {
  description: string;
  category: string;
  suggestion: string;
  install_cmd: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/self_upgrade.rs:32 InstallResult */
export interface UpgradeInstallResult {
  tool: string;
  success: boolean;
  output: string;
  [k: string]: unknown;
}

// ─── evolution.rs types ──────────────────────────────────────────────────────

/** @see src-tauri/src/evolution.rs:315 EvolutionLevel */
export interface EvolutionLevel {
  level: number;
  score: number;
  breakdown: string[];
  next_unlock?: string | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/evolution.rs:302 EvolutionSuggestion */
export interface EvolutionSuggestion {
  id: string;
  name: string;
  package: string;
  description: string;
  trigger_app: string;
  required_token_hint?: string | null;
  auto_install: boolean;
  status: string;
  created_at: number;
  [k: string]: unknown;
}

// ─── decision_gate.rs types ──────────────────────────────────────────────────

/** @see src-tauri/src/decision_gate.rs:62 DecisionRecord */
export interface DecisionLogEntry {
  id: string;
  signal: unknown;
  outcome: unknown;
  timestamp: number;
  feedback?: boolean | null;
  [k: string]: unknown;
}

// ─── authority_engine.rs types ───────────────────────────────────────────────

/** @see src-tauri/src/authority_engine.rs:23 AgentAuthority */
export interface AuthorityAgent {
  agent_type: string;
  description: string;
  allowed_actions: string[];
  denied_actions: string[];
  system_prompt: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/authority_engine.rs:32 Delegation */
export interface AuthorityDelegation {
  id: string;
  task: string;
  delegated_to: string;
  delegated_by: string;
  status: string;
  result: string;
  denied_reason: string;
  created_at: number;
  completed_at?: number | null;
  [k: string]: unknown;
}

/** authority_get_audit_log returns Vec<serde_json::Value>. */
export type AuthorityAuditEntry = Record<string, unknown>;

// ─── audit.rs types ──────────────────────────────────────────────────────────

/** @see src-tauri/src/audit.rs:19 AuditEntry */
export interface AuditLogEntry {
  timestamp: number;
  system: string;
  decision: string;
  reasoning: string;
  inputs: string;
  outcome: string;
  [k: string]: unknown;
}

/** Permissive union for consumer code that lists findings of mixed types. */
export interface SecurityScanResult {
  findings: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// ─── symbolic.rs types ───────────────────────────────────────────────────────

/** @see src-tauri/src/symbolic.rs:29 Policy */
export interface SymbolicPolicy {
  id: string;
  name: string;
  condition: string;
  action: string;
  reason: string;
  enabled: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/symbolic.rs:43 PolicyCheckResult */
export interface PolicyCheckResult {
  allowed: boolean;
  triggered_policies: string[];
  action: string;
  reason: string;
  [k: string]: unknown;
}

// ─── temporal_intel.rs types ─────────────────────────────────────────────────

/** temporal_daily_standup returns a free-form markdown/text briefing. */
export type TemporalStandup = string;

/** @see src-tauri/src/temporal_intel.rs:31 TemporalPattern */
export interface TemporalPattern {
  pattern_type: string;
  description: string;
  confidence: number;
  data_points: number;
  [k: string]: unknown;
}

// ─── execution_memory.rs types ───────────────────────────────────────────────

/** @see src-tauri/src/execution_memory.rs:20 ExecutionRecord */
export interface ExecutionMemoryEntry {
  id: number;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  timestamp: number;
  [k: string]: unknown;
}

// ─── supervisor.rs + trace.rs types ──────────────────────────────────────────

/** @see src-tauri/src/supervisor.rs:32 ServiceHealth */
export interface SupervisorService {
  name: string;
  status: string;
  crash_count: number;
  last_crash?: number | null;
  last_heartbeat: number;
  uptime_secs: number;
  started_at: number;
  [k: string]: unknown;
}

/** supervisor_get_health returns Vec<ServiceHealth>; consumers wrap in a grid. */
export interface SupervisorHealth {
  services: SupervisorService[];
  [k: string]: unknown;
}

/** @see src-tauri/src/trace.rs:7 TraceEntry */
export interface TraceEntry {
  trace_id: string;
  provider: string;
  model: string;
  method: string;
  duration_ms: number;
  success: boolean;
  error?: string | null;
  timestamp: string;
  [k: string]: unknown;
}

// ─── sysadmin.rs types ───────────────────────────────────────────────────────

/** @see src-tauri/src/sysadmin.rs:21 HardwareInfo (permissive) */
export interface HardwareInfo {
  cpu?: unknown;
  gpus?: unknown[];
  ram_total_gb?: number;
  iommu_groups?: unknown[];
  virtualization?: unknown;
  [k: string]: unknown;
}

/** @see src-tauri/src/sysadmin.rs:317 DryRunResult */
export interface SysadminDryRun {
  actions: Array<{
    action_type: string;
    target: string;
    description: string;
    preview: string;
    risk: string;
    [k: string]: unknown;
  }>;
  warnings: string[];
  reversible: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/sysadmin.rs:427 TaskCheckpoint */
export interface SysadminCheckpoint {
  id: string;
  title: string;
  steps: unknown[];
  current_step: number;
  created_at: number;
  updated_at: number;
  status: string;
  rollback_info: unknown[];
  [k: string]: unknown;
}

// ─── integration_bridge.rs types ─────────────────────────────────────────────

/** @see src-tauri/src/integration_bridge.rs:33 IntegrationState */
export interface IntegrationState {
  unread_emails: number;
  upcoming_events: unknown[];
  slack_mentions: number;
  github_notifications: number;
  last_updated: number;
  [k: string]: unknown;
}

// ─── self_critique.rs types ──────────────────────────────────────────────────

/** @see src-tauri/src/self_critique.rs:29 RoastSession */
export interface CritiqueEntry {
  id: string;
  user_request: string;
  original: string;
  critique: unknown;
  rebuilt?: string | null;
  improvement_summary: string;
  created_at: number;
  [k: string]: unknown;
}

// ─── tool_forge.rs types ─────────────────────────────────────────────────────

/** @see src-tauri/src/tool_forge.rs:26 ForgedTool */
export interface ForgeTool {
  id: string;
  name: string;
  description: string;
  language: string;
  script_path: string;
  usage: string;
  parameters: unknown[];
  test_output: string;
  created_at: number;
  last_used?: number | null;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// commands.rs — MCP management + admin helpers (14 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/commands.rs:2200 mcp_add_server
 * Rust signature: `mcp_add_server(state, name: String, command: String, args: Vec<String>) -> Result<(), String>`.
 * Note: Rust arg name is `args`. JS side uses `mcpArgs` to avoid collision
 * with the wrapper's outer args object; converted at the invoke boundary.
 */
export function mcpAddServer(args: {
  name: string;
  command: string;
  mcpArgs: string[];
}): Promise<void> {
  return invokeTyped<void, { name: string; command: string; args: string[] }>('mcp_add_server', {
    name: args.name,
    command: args.command,
    args: args.mcpArgs,
  });
}

/**
 * @see src-tauri/src/commands.rs:2299 mcp_install_catalog_server
 * Rust signature: `mcp_install_catalog_server(state, name: String, command: String, args: Vec<String>, env: HashMap<String,String>) -> Result<usize, String>`.
 */
export function mcpInstallCatalogServer(args: {
  name: string;
  command: string;
  mcpArgs: string[];
  env: Record<string, string>;
}): Promise<number> {
  return invokeTyped<
    number,
    { name: string; command: string; args: string[]; env: Record<string, string> }
  >('mcp_install_catalog_server', {
    name: args.name,
    command: args.command,
    args: args.mcpArgs,
    env: args.env,
  });
}

/**
 * @see src-tauri/src/commands.rs:2236 mcp_discover_tools
 * Rust signature: `mcp_discover_tools(state) -> Result<Vec<McpTool>, String>`.
 */
export function mcpDiscoverTools(): Promise<McpTool[]> {
  return invokeTyped<McpTool[]>('mcp_discover_tools');
}

/**
 * @see src-tauri/src/commands.rs:2244 mcp_call_tool
 * Rust signature: `mcp_call_tool(state, tool_name: String, arguments: serde_json::Value) -> Result<McpToolResult, String>`.
 */
export function mcpCallTool(args: {
  toolName: string;
  arguments: unknown;
}): Promise<McpToolResult> {
  return invokeTyped<McpToolResult, { tool_name: string; arguments: unknown }>('mcp_call_tool', {
    tool_name: args.toolName,
    arguments: args.arguments,
  });
}

/**
 * @see src-tauri/src/commands.rs:2254 mcp_get_tools
 * Rust signature: `mcp_get_tools(state) -> Result<Vec<McpTool>, String>`.
 */
export function mcpGetTools(): Promise<McpTool[]> {
  return invokeTyped<McpTool[]>('mcp_get_tools');
}

/**
 * @see src-tauri/src/commands.rs:2262 mcp_get_servers
 * Rust signature: `mcp_get_servers() -> Vec<SavedMcpServerConfig>`.
 */
export function mcpGetServers(): Promise<McpServerInfo[]> {
  return invokeTyped<McpServerInfo[]>('mcp_get_servers');
}

/**
 * @see src-tauri/src/commands.rs:2283 mcp_remove_server
 * Rust signature: `mcp_remove_server(state, name: String) -> Result<(), String>`.
 */
export function mcpRemoveServer(name: string): Promise<void> {
  return invokeTyped<void, { name: string }>('mcp_remove_server', { name });
}

/**
 * @see src-tauri/src/commands.rs:2267 mcp_server_status
 * Rust signature: `mcp_server_status(state) -> Result<Vec<(String, bool)>, String>`.
 */
export function mcpServerStatus(): Promise<Array<[string, boolean]>> {
  return invokeTyped<Array<[string, boolean]>>('mcp_server_status');
}

/**
 * @see src-tauri/src/commands.rs:2275 mcp_server_health
 * Rust signature: `mcp_server_health(state) -> Result<Vec<ServerHealth>, String>`.
 */
export function mcpServerHealth(): Promise<McpServerHealth[]> {
  return invokeTyped<McpServerHealth[]>('mcp_server_health');
}

/**
 * @see src-tauri/src/commands.rs:2190 test_provider
 * Rust signature: `test_provider(provider: String, api_key: String, model: String, base_url: Option<String>) -> Result<String, String>`.
 */
export function testProvider(args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Promise<ProviderTestResult> {
  return invokeTyped<
    ProviderTestResult,
    { provider: string; api_key: string; model: string; base_url?: string }
  >('test_provider', {
    provider: args.provider,
    api_key: args.apiKey,
    model: args.model,
    base_url: args.baseUrl,
  });
}

/**
 * @see src-tauri/src/commands.rs:2079 debug_config
 * Rust signature: `debug_config() -> serde_json::Value`.
 */
export function debugConfig(): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>>('debug_config');
}

/**
 * @see src-tauri/src/commands.rs:2109 set_config
 * Rust signature: `set_config(provider: String, api_key: String, model: String, token_efficient: Option<bool>, user_name: Option<String>, work_mode: Option<String>, response_style: Option<String>, blade_email: Option<String>, ...) -> Result<(), String>`.
 * Note: Rust takes additional optional onboarding fields; only the most
 * commonly-used five are surfaced here. Extend as needed in Plan 07-06.
 */
export function setConfig(args: {
  provider: string;
  apiKey: string;
  model: string;
  tokenEfficient?: boolean;
  userName?: string;
  workMode?: string;
  responseStyle?: string;
  bladeEmail?: string;
}): Promise<void> {
  return invokeTyped<
    void,
    {
      provider: string;
      api_key: string;
      model: string;
      token_efficient?: boolean;
      user_name?: string;
      work_mode?: string;
      response_style?: string;
      blade_email?: string;
    }
  >('set_config', {
    provider: args.provider,
    api_key: args.apiKey,
    model: args.model,
    token_efficient: args.tokenEfficient,
    user_name: args.userName,
    work_mode: args.workMode,
    response_style: args.responseStyle,
    blade_email: args.bladeEmail,
  });
}

/**
 * @see src-tauri/src/commands.rs:2173 update_init_prefs
 * Rust signature: `update_init_prefs(token_efficient: Option<bool>, user_name: Option<String>, work_mode: Option<String>, response_style: Option<String>, blade_email: Option<String>) -> Result<(), String>`.
 */
export function updateInitPrefs(args: {
  tokenEfficient?: boolean;
  userName?: string;
  workMode?: string;
  responseStyle?: string;
  bladeEmail?: string;
}): Promise<void> {
  return invokeTyped<
    void,
    {
      token_efficient?: boolean;
      user_name?: string;
      work_mode?: string;
      response_style?: string;
      blade_email?: string;
    }
  >('update_init_prefs', {
    token_efficient: args.tokenEfficient,
    user_name: args.userName,
    work_mode: args.workMode,
    response_style: args.responseStyle,
    blade_email: args.bladeEmail,
  });
}

/**
 * @see src-tauri/src/commands.rs:2099 reset_onboarding
 * Rust signature: `reset_onboarding() -> Result<(), String>`.
 */
export function resetOnboarding(): Promise<void> {
  return invokeTyped<void>('reset_onboarding');
}

// ═══════════════════════════════════════════════════════════════════════════
// permissions.rs — tool trust overrides (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/permissions.rs:111 classify_mcp_tool
 * Rust signature: `classify_mcp_tool(name: String, description: String) -> ToolRisk`.
 */
export function classifyMcpTool(args: {
  name: string;
  description: string;
}): Promise<ToolRisk> {
  return invokeTyped<ToolRisk, { name: string; description: string }>('classify_mcp_tool', {
    name: args.name,
    description: args.description,
  });
}

/**
 * @see src-tauri/src/permissions.rs:116 set_tool_trust
 * Rust signature: `set_tool_trust(tool_name: String, risk: ToolRisk) -> Result<(), String>`.
 */
export function setToolTrust(args: {
  toolName: string;
  risk: ToolRisk;
}): Promise<void> {
  return invokeTyped<void, { tool_name: string; risk: ToolRisk }>('set_tool_trust', {
    tool_name: args.toolName,
    risk: args.risk,
  });
}

/**
 * @see src-tauri/src/permissions.rs:123 reset_tool_trust
 * Rust signature: `reset_tool_trust(tool_name: String) -> Result<(), String>`.
 */
export function resetToolTrust(toolName: string): Promise<void> {
  return invokeTyped<void, { tool_name: string }>('reset_tool_trust', { tool_name: toolName });
}

/**
 * @see src-tauri/src/permissions.rs:130 get_tool_overrides
 * Rust signature: `get_tool_overrides() -> HashMap<String, ToolRisk>`.
 */
export function getToolOverrides(): Promise<ToolOverride> {
  return invokeTyped<ToolOverride>('get_tool_overrides');
}

// ═══════════════════════════════════════════════════════════════════════════
// db_commands.rs — analytics subset (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/db_commands.rs:236 db_track_event
 * Rust signature: `db_track_event(state, event_type: String, metadata: Option<String>) -> Result<(), String>`.
 */
export function dbTrackEvent(args: {
  eventType: string;
  metadata?: string;
}): Promise<void> {
  return invokeTyped<void, { event_type: string; metadata?: string }>('db_track_event', {
    event_type: args.eventType,
    metadata: args.metadata,
  });
}

/**
 * @see src-tauri/src/db_commands.rs:246 db_events_since
 * Rust signature: `db_events_since(state, since: i64) -> Result<Vec<AnalyticsEvent>, String>`.
 */
export function dbEventsSince(since: number): Promise<AnalyticsEvent[]> {
  return invokeTyped<AnalyticsEvent[], { since: number }>('db_events_since', { since });
}

/**
 * @see src-tauri/src/db_commands.rs:255 db_prune_analytics
 * Rust signature: `db_prune_analytics(state, older_than_days: i64) -> Result<usize, String>`.
 */
export function dbPruneAnalytics(olderThanDays: number): Promise<number> {
  return invokeTyped<number, { older_than_days: number }>('db_prune_analytics', {
    older_than_days: olderThanDays,
  });
}

/**
 * @see src-tauri/src/db_commands.rs:271 db_analytics_summary
 * Rust signature: `db_analytics_summary(state) -> Result<serde_json::Value, String>`.
 */
export function dbAnalyticsSummary(): Promise<AnalyticsSummary> {
  return invokeTyped<AnalyticsSummary>('db_analytics_summary');
}

// ═══════════════════════════════════════════════════════════════════════════
// reports.rs — capability_gap_detected surface (5 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/reports.rs:257 report_gap
 * Rust signature: `report_gap(app, category, title, description, user_request, blade_response, suggested_fix, severity) -> Result<String, String>`.
 */
export function reportGap(args: {
  category: string;
  title: string;
  description: string;
  userRequest: string;
  bladeResponse: string;
  suggestedFix: string;
  severity: string;
}): Promise<string> {
  return invokeTyped<
    string,
    {
      category: string;
      title: string;
      description: string;
      user_request: string;
      blade_response: string;
      suggested_fix: string;
      severity: string;
    }
  >('report_gap', {
    category: args.category,
    title: args.title,
    description: args.description,
    user_request: args.userRequest,
    blade_response: args.bladeResponse,
    suggested_fix: args.suggestedFix,
    severity: args.severity,
  });
}

/**
 * @see src-tauri/src/reports.rs:296 get_reports
 * Rust signature: `get_reports(limit: Option<usize>) -> Result<Vec<CapabilityReport>, String>`.
 */
export function getReports(limit?: number): Promise<Report[]> {
  return invokeTyped<Report[], { limit?: number }>('get_reports', { limit });
}

/**
 * @see src-tauri/src/reports.rs:303 update_report_status
 * Rust signature: `update_report_status(id: String, status: String) -> Result<(), String>`.
 */
export function updateReportStatus(args: {
  id: string;
  status: string;
}): Promise<void> {
  return invokeTyped<void, { id: string; status: string }>('update_report_status', {
    id: args.id,
    status: args.status,
  });
}

/**
 * @see src-tauri/src/reports.rs:310 set_report_webhook
 * Rust signature: `set_report_webhook(url: String) -> Result<(), String>`.
 */
export function setReportWebhook(url: string): Promise<void> {
  return invokeTyped<void, { url: string }>('set_report_webhook', { url });
}

/**
 * @see src-tauri/src/reports.rs:317 get_report_webhook
 * Rust signature: `get_report_webhook() -> String`.
 */
export function getReportWebhook(): Promise<string> {
  return invokeTyped<string>('get_report_webhook');
}

// ═══════════════════════════════════════════════════════════════════════════
// self_upgrade.rs — catalog + pentest auth (8 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/self_upgrade.rs:571 self_upgrade_install
 * Rust signature: `self_upgrade_install(tool_key: String) -> Result<InstallResult, String>`.
 */
export function selfUpgradeInstall(toolKey: string): Promise<UpgradeInstallResult> {
  return invokeTyped<UpgradeInstallResult, { tool_key: string }>('self_upgrade_install', {
    tool_key: toolKey,
  });
}

/**
 * @see src-tauri/src/self_upgrade.rs:581 self_upgrade_catalog
 * Rust signature: `self_upgrade_catalog() -> Vec<CapabilityGap>`.
 */
export function selfUpgradeCatalog(): Promise<UpgradeCatalogEntry[]> {
  return invokeTyped<UpgradeCatalogEntry[]>('self_upgrade_catalog');
}

/**
 * @see src-tauri/src/self_upgrade.rs:587 self_upgrade_audit
 * Rust signature: `self_upgrade_audit() -> Vec<(String, bool)>`.
 */
export function selfUpgradeAudit(): Promise<Array<[string, boolean]>> {
  return invokeTyped<Array<[string, boolean]>>('self_upgrade_audit');
}

// ═══════════════════════════════════════════════════════════════════════════
// evolution.rs — capability learning (6 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/evolution.rs:980 evolution_get_level
 * Rust signature: `evolution_get_level() -> EvolutionLevel`.
 */
export function evolutionGetLevel(): Promise<EvolutionLevel> {
  return invokeTyped<EvolutionLevel>('evolution_get_level');
}

/**
 * @see src-tauri/src/evolution.rs:986 evolution_get_suggestions
 * Rust signature: `evolution_get_suggestions() -> Vec<EvolutionSuggestion>`.
 */
export function evolutionGetSuggestions(): Promise<EvolutionSuggestion[]> {
  return invokeTyped<EvolutionSuggestion[]>('evolution_get_suggestions');
}

/**
 * @see src-tauri/src/evolution.rs:1019 evolution_dismiss_suggestion
 * Rust signature: `evolution_dismiss_suggestion(id: String) -> Result<(), String>`.
 */
export function evolutionDismissSuggestion(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('evolution_dismiss_suggestion', { id });
}

/**
 * @see src-tauri/src/evolution.rs:1032 evolution_install_suggestion
 * Rust signature: `evolution_install_suggestion(state, id: String, token_key: String, token_value: String) -> Result<String, String>`.
 */
export function evolutionInstallSuggestion(args: {
  id: string;
  tokenKey: string;
  tokenValue: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { id: string; token_key: string; token_value: string }
  >('evolution_install_suggestion', {
    id: args.id,
    token_key: args.tokenKey,
    token_value: args.tokenValue,
  });
}

/**
 * @see src-tauri/src/evolution.rs:1107 evolution_run_now
 * Rust signature: `evolution_run_now(app: AppHandle)`.
 */
export function evolutionRunNow(): Promise<void> {
  return invokeTyped<void>('evolution_run_now');
}

/**
 * @see src-tauri/src/evolution.rs:1115 evolution_log_capability_gap
 * Rust signature: `evolution_log_capability_gap(capability: String, user_request: String) -> String`.
 */
export function evolutionLogCapabilityGap(args: {
  capability: string;
  userRequest: string;
}): Promise<string> {
  return invokeTyped<string, { capability: string; user_request: string }>(
    'evolution_log_capability_gap',
    {
      capability: args.capability,
      user_request: args.userRequest,
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// immune_system.rs — capability gap auto-resolve (1 command)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/immune_system.rs:219 immune_resolve_gap
 * Rust signature: `immune_resolve_gap(app: AppHandle, capability: String, user_request: String) -> String`.
 */
export function immuneResolveGap(args: {
  capability: string;
  userRequest: string;
}): Promise<string> {
  return invokeTyped<string, { capability: string; user_request: string }>(
    'immune_resolve_gap',
    {
      capability: args.capability,
      user_request: args.userRequest,
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// decision_gate.rs — autonomous signal classifier (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/decision_gate.rs:376 get_decision_log
 * Rust signature: `get_decision_log() -> Vec<DecisionRecord>`.
 * Note: Rust does NOT take a limit — the log is ring-buffered to the 20 most
 * recent records server-side. The optional `limit` arg on JS is accepted but
 * ignored to keep the Plan 07-05 DecisionLog consumer API stable.
 */
export function getDecisionLog(_args?: { limit?: number }): Promise<DecisionLogEntry[]> {
  return invokeTyped<DecisionLogEntry[]>('get_decision_log');
}

/**
 * @see src-tauri/src/decision_gate.rs:390 decision_feedback
 * Rust signature: `decision_feedback(id: String, was_correct: bool) -> Result<(), String>`.
 */
export function decisionFeedback(args: {
  id: string;
  wasCorrect: boolean;
}): Promise<void> {
  return invokeTyped<void, { id: string; was_correct: boolean }>('decision_feedback', {
    id: args.id,
    was_correct: args.wasCorrect,
  });
}

/**
 * @see src-tauri/src/decision_gate.rs:413 decision_evaluate
 * Rust signature: `decision_evaluate(source: String, description: String, confidence: f64, reversible: bool, ...) -> Result<String, String>`.
 */
export function decisionEvaluate(args: {
  source: string;
  description: string;
  confidence: number;
  reversible: boolean;
}): Promise<string> {
  return invokeTyped<
    string,
    { source: string; description: string; confidence: number; reversible: boolean }
  >('decision_evaluate', {
    source: args.source,
    description: args.description,
    confidence: args.confidence,
    reversible: args.reversible,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// authority_engine.rs — specialist delegation (6 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/authority_engine.rs:622 authority_get_agents
 * Rust signature: `authority_get_agents() -> Vec<AgentAuthority>`.
 */
export function authorityGetAgents(): Promise<AuthorityAgent[]> {
  return invokeTyped<AuthorityAgent[]>('authority_get_agents');
}

/**
 * @see src-tauri/src/authority_engine.rs:627 authority_get_audit_log
 * Rust signature: `authority_get_audit_log(limit: Option<usize>) -> Vec<serde_json::Value>`.
 */
export function authorityGetAuditLog(limit?: number): Promise<AuthorityAuditEntry[]> {
  return invokeTyped<AuthorityAuditEntry[], { limit?: number }>('authority_get_audit_log', {
    limit,
  });
}

/**
 * @see src-tauri/src/authority_engine.rs:632 authority_get_delegations
 * Rust signature: `authority_get_delegations(limit: Option<usize>) -> Vec<Delegation>`.
 */
export function authorityGetDelegations(limit?: number): Promise<AuthorityDelegation[]> {
  return invokeTyped<AuthorityDelegation[], { limit?: number }>('authority_get_delegations', {
    limit,
  });
}

/**
 * @see src-tauri/src/authority_engine.rs:637 authority_delegate
 * Rust signature: `authority_delegate(task: String, agent_type: String, context: Option<String>) -> Result<String, String>`.
 */
export function authorityDelegate(args: {
  task: string;
  agentType: string;
  context?: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { task: string; agent_type: string; context?: string }
  >('authority_delegate', {
    task: args.task,
    agent_type: args.agentType,
    context: args.context,
  });
}

/**
 * @see src-tauri/src/authority_engine.rs:646 authority_route_and_run
 * Rust signature: `authority_route_and_run(task: String) -> Result<String, String>`.
 */
export function authorityRouteAndRun(task: string): Promise<string> {
  return invokeTyped<string, { task: string }>('authority_route_and_run', { task });
}

/**
 * @see src-tauri/src/authority_engine.rs:652 authority_run_chain
 * Rust signature: `authority_run_chain(task: String, agents: Vec<String>) -> Result<Vec<String>, String>`.
 */
export function authorityRunChain(args: {
  task: string;
  agents: string[];
}): Promise<string[]> {
  return invokeTyped<string[], { task: string; agents: string[] }>('authority_run_chain', {
    task: args.task,
    agents: args.agents,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// audit.rs — cross-system audit trail (1 command)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/audit.rs:101 audit_get_log
 * Rust signature: `audit_get_log(system: Option<String>, limit: Option<usize>) -> Vec<AuditEntry>`.
 */
export function auditGetLog(args: {
  system?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  return invokeTyped<AuditLogEntry[], { system?: string; limit?: number }>('audit_get_log', {
    system: args.system,
    limit: args.limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// symbolic.rs — policy engine (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/symbolic.rs:368 symbolic_check_policy
 * Rust signature: `symbolic_check_policy(action: String) -> PolicyCheckResult`.
 */
export function symbolicCheckPolicy(action: string): Promise<PolicyCheckResult> {
  return invokeTyped<PolicyCheckResult, { action: string }>('symbolic_check_policy', {
    action,
  });
}

/**
 * @see src-tauri/src/symbolic.rs:374 symbolic_list_policies
 * Rust signature: `symbolic_list_policies() -> Vec<Policy>`.
 */
export function symbolicListPolicies(): Promise<SymbolicPolicy[]> {
  return invokeTyped<SymbolicPolicy[]>('symbolic_list_policies');
}

/**
 * @see src-tauri/src/symbolic.rs:379 symbolic_add_policy
 * Rust signature: `symbolic_add_policy(id: String, name: String, condition: String, action: String, reason: String) -> Result<(), String>`.
 */
export function symbolicAddPolicy(args: {
  id: string;
  name: string;
  condition: string;
  action: string;
  reason: string;
}): Promise<void> {
  return invokeTyped<
    void,
    { id: string; name: string; condition: string; action: string; reason: string }
  >('symbolic_add_policy', {
    id: args.id,
    name: args.name,
    condition: args.condition,
    action: args.action,
    reason: args.reason,
  });
}

/**
 * @see src-tauri/src/symbolic.rs:406 symbolic_verify_plan
 * Rust signature: `symbolic_verify_plan(plan: String) -> Vec<String>`.
 */
export function symbolicVerifyPlan(plan: string): Promise<string[]> {
  return invokeTyped<string[], { plan: string }>('symbolic_verify_plan', { plan });
}

// ═══════════════════════════════════════════════════════════════════════════
// temporal_intel.rs — time-aware context (4 commands, shared with Phase 6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/temporal_intel.rs:706 temporal_what_was_i_doing
 * Rust signature: `temporal_what_was_i_doing(hours_ago: u32) -> Result<String, String>`.
 */
export function temporalWhatWasIDoing(hoursAgo: number): Promise<string> {
  return invokeTyped<string, { hours_ago: number }>('temporal_what_was_i_doing', {
    hours_ago: hoursAgo,
  });
}

/**
 * @see src-tauri/src/temporal_intel.rs:711 temporal_daily_standup
 * Rust signature: `temporal_daily_standup() -> Result<String, String>`.
 */
export function temporalDailyStandup(): Promise<TemporalStandup> {
  return invokeTyped<TemporalStandup>('temporal_daily_standup');
}

/**
 * @see src-tauri/src/temporal_intel.rs:716 temporal_detect_patterns
 * Rust signature: `temporal_detect_patterns() -> Vec<TemporalPattern>`.
 */
export function temporalDetectPatterns(): Promise<TemporalPattern[]> {
  return invokeTyped<TemporalPattern[]>('temporal_detect_patterns');
}

/**
 * @see src-tauri/src/temporal_intel.rs:721 temporal_meeting_prep
 * Rust signature: `temporal_meeting_prep(topic: String) -> Result<String, String>`.
 */
export function temporalMeetingPrep(topic: string): Promise<string> {
  return invokeTyped<string, { topic: string }>('temporal_meeting_prep', { topic });
}

// ═══════════════════════════════════════════════════════════════════════════
// execution_memory.rs — command execution history (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/execution_memory.rs:265 exmem_record
 * Rust signature: `exmem_record(command: String, cwd: String, stdout: String, stderr: String, ...) -> ...`.
 * Note: Rust fn takes more fields (exit_code, duration_ms); we surface the
 * four required strings plus two optional numerics.
 */
export function exmemRecord(args: {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
}): Promise<void> {
  return invokeTyped<
    void,
    {
      command: string;
      cwd: string;
      stdout: string;
      stderr: string;
      exit_code?: number;
      duration_ms?: number;
    }
  >('exmem_record', {
    command: args.command,
    cwd: args.cwd,
    stdout: args.stdout,
    stderr: args.stderr,
    exit_code: args.exitCode,
    duration_ms: args.durationMs,
  });
}

/**
 * @see src-tauri/src/execution_memory.rs:279 exmem_search
 * Rust signature: `exmem_search(query: String, limit: Option<usize>) -> Result<String, String>`.
 */
export function exmemSearch(args: { query: string; limit?: number }): Promise<string> {
  return invokeTyped<string, { query: string; limit?: number }>('exmem_search', {
    query: args.query,
    limit: args.limit,
  });
}

/**
 * @see src-tauri/src/execution_memory.rs:286 exmem_recent
 * Rust signature: `exmem_recent(limit: Option<usize>) -> Result<Vec<ExecutionRecord>, String>`.
 */
export function exmemRecent(limit?: number): Promise<ExecutionMemoryEntry[]> {
  return invokeTyped<ExecutionMemoryEntry[], { limit?: number }>('exmem_recent', { limit });
}

// ═══════════════════════════════════════════════════════════════════════════
// supervisor.rs — background task health (2 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/supervisor.rs:225 supervisor_get_health
 * Rust signature: `supervisor_get_health() -> Vec<ServiceHealth>`.
 * Note: Rust returns a flat Vec. Plan 07-06 Diagnostics wraps it into
 * `{ services: [...] }` client-side for the health-grid pattern.
 */
export function supervisorGetHealth(): Promise<SupervisorService[]> {
  return invokeTyped<SupervisorService[]>('supervisor_get_health');
}

/**
 * @see src-tauri/src/supervisor.rs:233 supervisor_get_service
 * Rust signature: `supervisor_get_service(name: String) -> Option<ServiceHealth>`.
 */
export function supervisorGetService(name: string): Promise<SupervisorService | null> {
  return invokeTyped<SupervisorService | null, { name: string }>('supervisor_get_service', {
    name,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// trace.rs — provider traces (1 command)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/trace.rs:71 get_recent_traces
 * Rust signature: `get_recent_traces() -> Vec<TraceEntry>`.
 */
export function getRecentTraces(): Promise<TraceEntry[]> {
  return invokeTyped<TraceEntry[]>('get_recent_traces');
}

// ═══════════════════════════════════════════════════════════════════════════
// sysadmin.rs — hardware, dry-runs, checkpoints, privileged ops (8 commands)
// Dangerous operations are Dialog-gated by consumers (D-183).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/sysadmin.rs:614 sysadmin_detect_hardware
 * Rust signature: `sysadmin_detect_hardware() -> HardwareInfo`.
 */
export function sysadminDetectHardware(): Promise<HardwareInfo> {
  return invokeTyped<HardwareInfo>('sysadmin_detect_hardware');
}

/**
 * @see src-tauri/src/sysadmin.rs:619 sysadmin_dry_run_edit
 * Rust signature: `sysadmin_dry_run_edit(path: String, old_content: String, new_content: String) -> DryRunResult`.
 */
export function sysadminDryRunEdit(args: {
  path: string;
  oldContent: string;
  newContent: string;
}): Promise<SysadminDryRun> {
  return invokeTyped<
    SysadminDryRun,
    { path: string; old_content: string; new_content: string }
  >('sysadmin_dry_run_edit', {
    path: args.path,
    old_content: args.oldContent,
    new_content: args.newContent,
  });
}

/**
 * @see src-tauri/src/sysadmin.rs:624 sysadmin_dry_run_command
 * Rust signature: `sysadmin_dry_run_command(command: String) -> DryRunResult`.
 */
export function sysadminDryRunCommand(command: string): Promise<SysadminDryRun> {
  return invokeTyped<SysadminDryRun, { command: string }>('sysadmin_dry_run_command', {
    command,
  });
}

/**
 * @see src-tauri/src/sysadmin.rs:629 sysadmin_list_checkpoints
 * Rust signature: `sysadmin_list_checkpoints() -> Vec<TaskCheckpoint>`.
 */
export function sysadminListCheckpoints(): Promise<SysadminCheckpoint[]> {
  return invokeTyped<SysadminCheckpoint[]>('sysadmin_list_checkpoints');
}

/**
 * @see src-tauri/src/sysadmin.rs:634 sysadmin_save_checkpoint
 * Rust signature: `sysadmin_save_checkpoint(checkpoint: TaskCheckpoint) -> Result<(), String>`.
 */
export function sysadminSaveCheckpoint(checkpoint: SysadminCheckpoint): Promise<void> {
  return invokeTyped<void, { checkpoint: SysadminCheckpoint }>('sysadmin_save_checkpoint', {
    checkpoint,
  });
}

/**
 * @see src-tauri/src/sysadmin.rs:639 sysadmin_load_checkpoint
 * Rust signature: `sysadmin_load_checkpoint(id: String) -> Option<TaskCheckpoint>`.
 */
export function sysadminLoadCheckpoint(id: string): Promise<SysadminCheckpoint | null> {
  return invokeTyped<SysadminCheckpoint | null, { id: string }>('sysadmin_load_checkpoint', {
    id,
  });
}

/**
 * @see src-tauri/src/sysadmin.rs:644 sysadmin_rollback
 * Rust signature: `sysadmin_rollback(id: String) -> Result<usize, String>`.
 */
export function sysadminRollback(id: string): Promise<number> {
  return invokeTyped<number, { id: string }>('sysadmin_rollback', { id });
}

/**
 * @see src-tauri/src/sysadmin.rs:649 sysadmin_sudo_exec
 * Rust signature: `sysadmin_sudo_exec(app: AppHandle, command: String, reason: String) -> Result<(String, String, i32), String>`.
 * Returns a tuple `[stdout, stderr, exit_code]`.
 */
export function sysadminSudoExec(args: {
  command: string;
  reason: string;
}): Promise<[string, string, number]> {
  return invokeTyped<[string, string, number], { command: string; reason: string }>(
    'sysadmin_sudo_exec',
    {
      command: args.command,
      reason: args.reason,
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// integration_bridge.rs — Gmail/Calendar/Slack/GitHub bridge (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/integration_bridge.rs:439 integration_get_state
 * Rust signature: `integration_get_state() -> IntegrationState`.
 */
export function integrationGetState(): Promise<IntegrationState> {
  return invokeTyped<IntegrationState>('integration_get_state');
}

/**
 * @see src-tauri/src/integration_bridge.rs:445 integration_toggle
 * Rust signature: `integration_toggle(service: String, enabled: bool) -> Result<(), String>`.
 */
export function integrationToggle(args: {
  service: string;
  enabled: boolean;
}): Promise<void> {
  return invokeTyped<void, { service: string; enabled: boolean }>('integration_toggle', {
    service: args.service,
    enabled: args.enabled,
  });
}

/**
 * @see src-tauri/src/integration_bridge.rs:462 integration_poll_now
 * Rust signature: `integration_poll_now(service: String) -> Result<IntegrationState, String>`.
 */
export function integrationPollNow(service: string): Promise<IntegrationState> {
  return invokeTyped<IntegrationState, { service: string }>('integration_poll_now', {
    service,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// config.rs — provider keys + task routing (6 commands)
// These also exist in lib/tauri/config.ts; both resolve to the same Rust
// command. Consumers pick the path via the cluster-scoped barrel.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/config.rs:604 get_all_provider_keys
 * Rust signature: `get_all_provider_keys() -> serde_json::Value`.
 */
export function getAllProviderKeys(): Promise<ProviderKeyList> {
  return invokeTyped<ProviderKeyList>('get_all_provider_keys');
}

/**
 * @see src-tauri/src/config.rs:635 store_provider_key
 * Rust signature: `store_provider_key(provider: String, api_key: String) -> Result<(), String>`.
 */
export function storeProviderKey(args: {
  provider: string;
  apiKey: string;
}): Promise<void> {
  return invokeTyped<void, { provider: string; api_key: string }>('store_provider_key', {
    provider: args.provider,
    api_key: args.apiKey,
  });
}

/**
 * @see src-tauri/src/config.rs:644 switch_provider
 * Rust signature: `switch_provider(provider: String, model: Option<String>) -> Result<BladeConfig, String>`.
 */
export function switchProvider(args: {
  provider: string;
  model?: string;
}): Promise<Record<string, unknown>> {
  return invokeTyped<
    Record<string, unknown>,
    { provider: string; model?: string }
  >('switch_provider', {
    provider: args.provider,
    model: args.model,
  });
}

/**
 * @see src-tauri/src/config.rs:712 get_task_routing
 * Rust signature: `get_task_routing() -> TaskRouting`.
 */
export function getTaskRouting(): Promise<TaskRouting> {
  return invokeTyped<TaskRouting>('get_task_routing');
}

/**
 * @see src-tauri/src/config.rs:718 set_task_routing
 * Rust signature: `set_task_routing(routing: TaskRouting) -> Result<(), String>`.
 */
export function setTaskRouting(routing: TaskRouting): Promise<void> {
  return invokeTyped<void, { routing: TaskRouting }>('set_task_routing', { routing });
}

/**
 * @see src-tauri/src/config.rs:727 save_config_field
 * Rust signature: `save_config_field(key: String, value: String) -> Result<(), String>`.
 */
export function saveConfigField(args: {
  key: string;
  value: string;
}): Promise<void> {
  return invokeTyped<void, { key: string; value: string }>('save_config_field', {
    key: args.key,
    value: args.value,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// self_critique.rs — response critique + weekly meta (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/self_critique.rs:566 self_critique_response
 * Rust signature: `self_critique_response(user_request: String, blade_response: String) -> Result<RoastSession, String>`.
 */
export function selfCritiqueResponse(args: {
  userRequest: string;
  bladeResponse: string;
}): Promise<CritiqueEntry> {
  return invokeTyped<
    CritiqueEntry,
    { user_request: string; blade_response: string }
  >('self_critique_response', {
    user_request: args.userRequest,
    blade_response: args.bladeResponse,
  });
}

/**
 * @see src-tauri/src/self_critique.rs:575 self_critique_history
 * Rust signature: `self_critique_history(limit: Option<usize>) -> Vec<RoastSession>`.
 */
export function selfCritiqueHistory(limit?: number): Promise<CritiqueEntry[]> {
  return invokeTyped<CritiqueEntry[], { limit?: number }>('self_critique_history', { limit });
}

/**
 * @see src-tauri/src/self_critique.rs:582 self_critique_deep_roast
 * Rust signature: `self_critique_deep_roast(user_request: String, blade_response: String) -> Result<String, String>`.
 */
export function selfCritiqueDeepRoast(args: {
  userRequest: string;
  bladeResponse: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { user_request: string; blade_response: string }
  >('self_critique_deep_roast', {
    user_request: args.userRequest,
    blade_response: args.bladeResponse,
  });
}

/**
 * @see src-tauri/src/self_critique.rs:591 self_critique_weekly_meta
 * Rust signature: `self_critique_weekly_meta() -> Result<String, String>`.
 */
export function selfCritiqueWeeklyMeta(): Promise<string> {
  return invokeTyped<string>('self_critique_weekly_meta');
}

// ═══════════════════════════════════════════════════════════════════════════
// tool_forge.rs — self-expanding capability engine (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/tool_forge.rs:506 forge_new_tool
 * Rust signature: `forge_new_tool(capability: String) -> Result<ForgedTool, String>`.
 */
export function forgeNewTool(capability: string): Promise<ForgeTool> {
  return invokeTyped<ForgeTool, { capability: string }>('forge_new_tool', { capability });
}

/**
 * @see src-tauri/src/tool_forge.rs:512 forge_list_tools
 * Rust signature: `forge_list_tools() -> Vec<ForgedTool>`.
 */
export function forgeListTools(): Promise<ForgeTool[]> {
  return invokeTyped<ForgeTool[]>('forge_list_tools');
}

/**
 * @see src-tauri/src/tool_forge.rs:518 forge_delete_tool
 * Rust signature: `forge_delete_tool(id: String) -> Result<(), String>`.
 */
export function forgeDeleteTool(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('forge_delete_tool', { id });
}

/**
 * @see src-tauri/src/tool_forge.rs:543 forge_test_tool
 * Rust signature: `forge_test_tool(id: String) -> Result<String, String>`.
 */
export function forgeTestTool(id: string): Promise<string> {
  return invokeTyped<string, { id: string }>('forge_test_tool', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// doctor.rs — diagnostic aggregator (3 commands)
//
// Phase 17 / DOCTOR-01. See:
//   src-tauri/src/doctor.rs
//   .planning/phases/17-doctor-module/17-CONTEXT.md (D-19, D-02..04)
//
// Wire form: SignalClass uses #[serde(rename_all = "snake_case")];
// Severity uses #[serde(rename_all = "lowercase")]. The literal unions
// below MUST stay in lockstep with the Rust enum variants.
// Phase 25 added 'metacognitive' (META-05).
// Phase 27 added 'hormones' (HORM-08).
// ═══════════════════════════════════════════════════════════════════════════

export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update'
  | 'reward_trend'
  | 'metacognitive'
  | 'hormones'            // Phase 27 / HORM-08
  | 'active_inference'    // Phase 28 / AINF-01 (was missing from TS)
  | 'vitality';           // Phase 29 / VITA-05

export type Severity = 'green' | 'amber' | 'red';

export interface DoctorSignal {
  class: SignalClass;
  severity: Severity;
  payload: unknown;
  /** Unix milliseconds. */
  last_changed_at: number;
  suggested_fix: string;
}

/**
 * @see src-tauri/src/doctor.rs::doctor_run_full_check
 * Rust signature: `doctor_run_full_check(app: AppHandle) -> Result<Vec<DoctorSignal>, String>`.
 *
 * Runs all 5 signal sources in parallel, caches the aggregated list,
 * emits `doctor_event` + `blade_activity_log` on severity transitions
 * (per CONTEXT.md D-20 / D-21).
 */
export function doctorRunFullCheck(): Promise<DoctorSignal[]> {
  return invokeTyped<DoctorSignal[]>('doctor_run_full_check');
}

/**
 * @see src-tauri/src/doctor.rs::doctor_get_recent
 * Rust signature: `doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal>`.
 *
 * Returns the last cached run; if `class` is provided, filters to that
 * class's history.
 */
export function doctorGetRecent(
  args: { class?: SignalClass | null } = {}
): Promise<DoctorSignal[]> {
  return invokeTyped<DoctorSignal[], { class: SignalClass | null }>(
    'doctor_get_recent',
    { class: args.class ?? null }
  );
}

/**
 * @see src-tauri/src/doctor.rs::doctor_get_signal
 * Rust signature: `doctor_get_signal(class: SignalClass) -> Option<DoctorSignal>`.
 */
export function doctorGetSignal(
  args: { class: SignalClass }
): Promise<DoctorSignal | null> {
  return invokeTyped<DoctorSignal | null, { class: SignalClass }>(
    'doctor_get_signal',
    args
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 18 — JARVIS chat-first (chat → cross-app action) — 6 commands
//
// ego.rs (1) + intent_router.rs (1) + jarvis_dispatch.rs (1) + consent.rs (3).
// All six already registered in `src-tauri/src/lib.rs` generate_handler! — see
// .planning/phases/18-jarvis-ptt-cross-app/18-04-SUMMARY.md for the wire
// catalogue. Wire form mirrors Rust serde:
//   - Enum tag      → discriminator field literally named `kind`.
//   - Variant names → snake_case (rename_all = "snake_case").
//   - Struct fields → snake_case (Rust default + the explicit serde rename).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/ego.rs:14 EgoVerdict
 * Rust derive: `#[serde(tag = "kind", rename_all = "snake_case")]`.
 *
 * Refusal/capability_gap fields mirror the struct variant payload verbatim
 * (T-18-CARRY-29: drift detection is human code-review per D-38-payload).
 */
export type EgoVerdict =
  | { kind: 'pass' }
  | { kind: 'refusal'; pattern: string; reason: string }
  | { kind: 'capability_gap'; capability: string; suggestion: string };

/**
 * @see src-tauri/src/intent_router.rs:15 IntentClass
 * Rust derive: `#[serde(tag = "kind", rename_all = "snake_case")]`.
 *
 * `action_required` carries the (service, action) tuple resolved by the
 * heuristic-first classifier (Plan 18-06). LLM-fallback returns `chat_only`
 * unconditionally in v1.2 (deferred per 18-DEFERRAL.md).
 */
export type IntentClass =
  | { kind: 'chat_only' }
  | { kind: 'action_required'; service: string; action: string };

/**
 * @see src-tauri/src/jarvis_dispatch.rs:24 DispatchResult
 * Rust derive: `#[serde(tag = "kind", rename_all = "snake_case")]`.
 *
 * `executed.payload` is `serde_json::Value` Rust-side — kept loose here per
 * D-38-payload (each tentacle's success payload differs; consumers branch on
 * service + parse out the fields they need).
 */
export type DispatchResult =
  | { kind: 'executed'; service: string; payload: unknown }
  | { kind: 'no_consent' }
  | { kind: 'hard_failed_no_creds'; service: string; suggestion: string }
  | { kind: 'not_applicable' };

/**
 * @see src-tauri/src/ego.rs:295 ego_intercept
 * Rust signature: `ego_intercept(transcript: String) -> EgoVerdict`.
 *
 * Synchronous classification surface — does NOT trigger retries / installs.
 * The full retry+install orchestration is `ego::handle_refusal` (consumed
 * inside commands.rs send_message_stream tool-loop branch — Plan 18-10).
 */
export function egoIntercept(transcript: string): Promise<EgoVerdict> {
  return invokeTyped<EgoVerdict, { transcript: string }>('ego_intercept', { transcript });
}

/**
 * @see src-tauri/src/intent_router.rs intent_router_classify
 * Rust signature (Plan 18-14 widened):
 *   `intent_router_classify(message: String) -> serde_json::Value`
 *   shape: `{ intent: IntentClass, args: Record<string, unknown> }`
 *
 * Heuristic-first (verb × service token); LLM-fallback DEFERRED to v1.3 per
 * 18-DEFERRAL.md path B. Args extracted heuristically per service/verb.
 */
export interface IntentClassifyResult {
  intent: IntentClass;
  args: Record<string, unknown>;
}
export function intentRouterClassify(message: string): Promise<IntentClassifyResult> {
  return invokeTyped<IntentClassifyResult, { message: string }>(
    'intent_router_classify',
    { message },
  );
}

/**
 * @see src-tauri/src/jarvis_dispatch.rs jarvis_dispatch_action
 * Rust signature (Plan 18-14 widened):
 *   `jarvis_dispatch_action(app, intent: IntentClass, args: serde_json::Value)
 *    -> Result<DispatchResult, String>`.
 *
 * 3-tier dispatch: native tentacle → MCP fallback → native_tools (D-05/06/07).
 * Consent gate (T-18-01) runs first; on `NeedsPrompt` the dispatcher AWAITS
 * the user's choice via the Plan-14 oneshot channel — `consentRespond` from
 * ConsentDialog completes the await in-place (no re-invoke).
 */
export function jarvisDispatchAction(
  intent: IntentClass,
  args: Record<string, unknown> = {},
): Promise<DispatchResult> {
  return invokeTyped<DispatchResult, { intent: IntentClass; args: Record<string, unknown> }>(
    'jarvis_dispatch_action',
    { intent, args },
  );
}

/**
 * @see src-tauri/src/consent.rs consent_respond
 * Rust signature: `consent_respond(request_id: String, choice: String) -> Result<(), String>`.
 *
 * Plan 18-14 — Frontend ConsentDialog calls this on user click. The dispatcher
 * awaits the matching oneshot Receiver and resumes in-place (no re-invoke,
 * no `'post'` hardcode). `choice` is allow-list validated Rust-side; the TS
 * literal-union prevents drift at compile time.
 */
export function consentRespond(
  requestId: string,
  choice: 'allow_once' | 'allow_always' | 'denied',
): Promise<void> {
  return invokeTyped<void, { request_id: string; choice: string }>(
    'consent_respond',
    { request_id: requestId, choice },
  );
}

/**
 * @see src-tauri/src/consent.rs:62 consent_get_decision
 * Rust signature: `consent_get_decision(intent_class: String, target_service: String) -> Option<String>`.
 *
 * Returns `null` when no row exists; otherwise `"allow_always"` or `"denied"`.
 * `allow_once` is NEVER persisted (RESEARCH Open Q1 / T-18-CARRY-15).
 */
export function consentGetDecision(
  intentClass: string,
  targetService: string,
): Promise<string | null> {
  return invokeTyped<string | null, { intent_class: string; target_service: string }>(
    'consent_get_decision',
    { intent_class: intentClass, target_service: targetService },
  );
}

/**
 * @see src-tauri/src/consent.rs:76 consent_set_decision
 * Rust signature: `consent_set_decision(intent_class: String, target_service: String, decision: String) -> Result<(), String>`.
 *
 * `decision` MUST be `'allow_always'` or `'denied'`. Passing `'allow_once'`
 * is a Rust-side error (T-18-CARRY-15); the TS literal-union prevents it at
 * compile time. The `allow_once` flow re-invokes dispatch WITHOUT calling
 * this function.
 */
export function consentSetDecision(
  intentClass: string,
  targetService: string,
  decision: 'allow_always' | 'denied',
): Promise<void> {
  return invokeTyped<
    void,
    { intent_class: string; target_service: string; decision: 'allow_always' | 'denied' }
  >('consent_set_decision', {
    intent_class: intentClass,
    target_service: targetService,
    decision,
  });
}

/**
 * @see src-tauri/src/consent.rs:99 consent_revoke_all
 * Rust signature: `consent_revoke_all() -> Result<(), String>`.
 *
 * Wipes every row from `consent_decisions`. Used by Settings → Privacy
 * "Revoke all consents" (D-10).
 */
export function consentRevokeAll(): Promise<void> {
  return invokeTyped<void>('consent_revoke_all');
}

// ═══════════════════════════════════════════════════════════════════════════
// brain.rs — Context Budget Breakdown (Phase 32 / CTX-06)
//
// @see src-tauri/src/brain.rs::ContextBreakdown (struct)
// @see src-tauri/src/brain.rs::get_context_breakdown (Tauri command)
// @see .planning/phases/32-context-management/32-06-PLAN.md
//
// DoctorPane's ContextBudgetSection consumes this command after every
// `chat_done` event to render the per-section token tally for the most
// recent build_system_prompt_inner call.
//
// Wire shape: struct ContextBreakdown derives Serialize with default field
// names (no rename_all). All fields are snake_case verbatim.
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/brain.rs:217 ContextBreakdown */
export type ContextBreakdown = {
  /** 16-char hex prefix of SHA-256(query). May be "" if not populated. */
  query_hash: string;
  /** Model context window from capability_probe (e.g. 200_000 for Claude Sonnet 4). */
  model_context_window: number;
  /** Sum of all section token counts (excluding tools/messages). */
  total_tokens: number;
  /** Per-section token tally. Stable label set documented in brain.rs. */
  sections: Record<string, number>;
  /** total_tokens / model_context_window * 100. Clamped to [0, 100]. */
  percent_used: number;
  /** Unix epoch milliseconds when the breakdown was captured. */
  timestamp_ms: number;
};

/**
 * @see src-tauri/src/brain.rs::get_context_breakdown
 * Rust signature: `get_context_breakdown() -> Result<ContextBreakdown, String>`.
 *
 * Returns the per-section token breakdown of the most recent
 * `build_system_prompt_inner` invocation. If no prompt has been built yet,
 * returns a zeroed-out breakdown (sections empty, total_tokens 0). The
 * DoctorPane Context Budget panel calls this after every `chat_done` event.
 */
export function getContextBreakdown(): Promise<ContextBreakdown> {
  return invokeTyped<ContextBreakdown>('get_context_breakdown');
}
