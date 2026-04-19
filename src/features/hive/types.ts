// src/features/hive/types.ts — Hive cluster-local type barrel.
// Re-exports wrapper-level types from @/lib/tauri/hive + cluster-only UI types.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-208
// @see src/lib/tauri/hive.ts

export type {
  TentacleStatus,
  Priority,
  TentacleReport,
  TentacleSummary,
  Decision,
  HiveStatus,
  AiDelegateInfo,
} from '@/lib/tauri/hive';

/**
 * Enumerated tentacle platform names. The 10 platforms the hive knows about.
 * TentacleDetail reads `prefs.hive.activeTentacle` as this union (D-210).
 * Derived from hive.rs + Phase 1..7 tentacle audit.
 */
export type TentaclePlatform =
  | 'github'
  | 'slack'
  | 'email'
  | 'calendar'
  | 'discord'
  | 'linear'
  | 'cloud'
  | 'log'
  | 'terminal'
  | 'filesystem';
