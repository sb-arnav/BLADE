// src/features/body/types.ts — Body cluster-local type barrel.
// Re-exports wrapper-level types from @/lib/tauri/body + cluster-only UI types.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-208
// @see src/lib/tauri/body.ts

export type {
  ModuleMapping,
  OrganStatus,
  OrganCapability,
  WorldState,
  GitRepoState,
  ProcessInfo,
  PortInfo,
  FileChange,
  SystemLoad,
  TodoItem,
  BloodPressure,
  EventInfo,
  VitalSigns,
  ImmuneStatus,
  InheritedDna,
} from '@/lib/tauri/body';

/**
 * Enumerated body-system names used by BodyMap + BodySystemDetail routing.
 * Derived from body_registry.rs — every module is categorised into ONE of
 * these 12 systems. Plan 08-03 consumes this for type-safe route handoff
 * via prefs.body.activeSystem (D-210).
 */
export type BodySystemName =
  | 'nervous'
  | 'vision'
  | 'audio'
  | 'muscular'
  | 'memory'
  | 'identity'
  | 'endocrine'
  | 'cardiovascular'
  | 'hive'
  | 'immune'
  | 'skeleton'
  | 'infrastructure';
