// src/types/hormones.ts — DTOs for src-tauri/src/homeostasis.rs.
//
// HormoneState mirrors `HormoneState` (homeostasis.rs:28) verbatim. It is a
// SUPERSET of the Phase 1 `HormoneUpdatePayload` in src/lib/events/payloads.ts:
// the event payload omits `last_updated`, the homeostasis_get command returns
// it. Both shapes coexist — components reading the command response see
// last_updated; event handlers do not.
//
// ModuleDirective mirrors `ModuleDirective` (homeostasis.rs:698). The plan's
// initial snippet (module/tier/multiplier) did NOT match Rust — actual Rust
// shape is { model_tier, poll_rate, allow_expensive_ops, autonomous, reason }
// per D-38 the Rust struct is authoritative.
//
// @see src-tauri/src/homeostasis.rs:28   (pub struct HormoneState)
// @see src-tauri/src/homeostasis.rs:698  (pub struct ModuleDirective)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-75

export interface HormoneState {
  /** 0.0 = deep sleep/idle → 1.0 = critical alert. */
  arousal: number;
  /** 0.0 = conserve → 1.0 = full power. */
  energy_mode: number;
  /** 0.0 = exploit → 1.0 = explore. */
  exploration: number;
  /** 0.0 = paranoid → 1.0 = full trust. */
  trust: number;
  /** 0.0 = calm → 1.0 = urgent. */
  urgency: number;
  /** 0.0 = satiated → 1.0 = starving (pending work). */
  hunger: number;
  /** 0.0 = fresh data → 1.0 = stale. */
  thirst: number;
  /** 0.0 = budget plenty → 1.0 = budget critical. */
  insulin: number;
  /** 0.0 = calm → 1.0 = emergency burst. */
  adrenaline: number;
  /** 0.0 = knowledge-hungry → 1.0 = satiated. */
  leptin: number;
  /** ms-since-epoch (Rust i64). 0 = never updated. */
  last_updated: number;
}

export interface ModuleDirective {
  /** "quality" | "balanced" | "cheap" | "skip" */
  model_tier: string;
  /** Multiplier on the module's normal poll cadence (1.0 = normal). */
  poll_rate: number;
  /** Whether the module may run LLM calls / web fetches / other expensive ops. */
  allow_expensive_ops: boolean;
  /** Whether the module may act without first asking the user. */
  autonomous: boolean;
  /** One-line debug-friendly reason for these settings. */
  reason: string;
}
