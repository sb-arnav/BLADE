// src/features/admin/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + UI-only types.
//
// Plans 07-05 and 07-06 import payload types from here (single import path)
// and add their own UI-only types via future extensions.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-188

export type {
  McpServerInfo,
  McpTool,
  McpServerHealth,
  McpToolResult,
  ProviderTestResult,
  ProviderKeyList,
  ProviderKey,
  TaskRouting,
  ToolRisk,
  ToolOverride,
  AnalyticsEvent,
  AnalyticsSummary,
  Report,
  UpgradeCatalogEntry,
  UpgradeInstallResult,
  EvolutionLevel,
  EvolutionSuggestion,
  DecisionLogEntry,
  AuthorityAgent,
  AuthorityDelegation,
  AuthorityAuditEntry,
  AuditLogEntry,
  SymbolicPolicy,
  PolicyCheckResult,
  TemporalStandup,
  TemporalPattern,
  ExecutionMemoryEntry,
  SupervisorService,
  SupervisorHealth,
  TraceEntry,
  HardwareInfo,
  SysadminDryRun,
  SysadminCheckpoint,
  IntegrationState,
  CritiqueEntry,
  ForgeTool,
} from '@/lib/tauri/admin';

// ─── Cluster-only UI types ───────────────────────────────────────────────────

export type AdminTabKey = string;

export interface AdminKpi {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
}
