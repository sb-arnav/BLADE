// tests/e2e/_fixtures/hive-status.ts — Phase 8 Plan 08-05 shared fixtures.
//
// Canned payloads matching the Rust wire shapes for the 4 Phase 8 specs
// (body-map / hormone-bus / hive-mesh / approval-queue). Shared fixtures
// avoid boilerplate duplication across specs and make it obvious which
// command each spec is asserting against.
//
// Rust authority:
//   - body_registry.rs:233   -> body_get_summary (Vec<(String, usize)>)
//   - body_registry.rs:239   -> body_get_map     (Vec<ModuleMapping>)
//   - body_registry.rs:244   -> body_get_system  (Vec<ModuleMapping>)
//   - homeostasis.rs:28      -> HormoneState
//   - hive.rs                -> HiveStatus + TentacleSummary + Decision
//
// Keep shapes `as const` so TS prevents accidental mutation and the specs
// can destructure without type widening surprises.
//
// @see tests/e2e/body-map.spec.ts
// @see tests/e2e/hormone-bus.spec.ts
// @see tests/e2e/hive-mesh.spec.ts
// @see tests/e2e/approval-queue.spec.ts
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 1

// ─── BodyMap / BodySystemDetail fixtures (SC-1) ─────────────────────────────

/** 12-system summary (D-201 hero derives "12 body systems, N modules"). */
export const MOCK_BODY_SUMMARY: Array<[string, number]> = [
  ['nervous', 19],
  ['vision', 7],
  ['audio', 10],
  ['muscular', 8],
  ['memory', 11],
  ['identity', 6],
  ['endocrine', 1],
  ['cardiovascular', 1],
  ['hive', 3],
  ['immune', 7],
  ['skeleton', 6],
  ['infrastructure', 3],
];

/** Enough modules to populate every system card's hover-preview list (≤ 3). */
export const MOCK_BODY_MAP = [
  { module: 'brain', body_system: 'nervous', organ: 'cerebrum', description: 'System prompt assembly' },
  { module: 'brainstem', body_system: 'nervous', organ: 'medulla', description: 'Background loops' },
  { module: 'cortex', body_system: 'nervous', organ: 'cerebrum', description: 'Higher-order reasoning' },
  { module: 'screen', body_system: 'vision', organ: 'retina', description: 'Screen capture + OCR' },
  { module: 'ocr_fusion', body_system: 'vision', organ: 'v1', description: 'OCR routing' },
  { module: 'microphone', body_system: 'audio', organ: 'cochlea', description: 'Mic capture' },
  { module: 'whisper', body_system: 'audio', organ: 'cortex', description: 'Transcription' },
  { module: 'computer_use', body_system: 'muscular', organ: 'skeletal', description: 'Keyboard + mouse' },
  { module: 'memory', body_system: 'memory', organ: 'hippocampus', description: 'Letta-style memory' },
  { module: 'dna', body_system: 'identity', organ: 'nucleus', description: 'Identity store' },
  { module: 'homeostasis', body_system: 'endocrine', organ: 'pituitary', description: 'Hormone regulator' },
  { module: 'cardiovascular', body_system: 'cardiovascular', organ: 'heart', description: 'Vital-sign fan-out' },
  { module: 'hive', body_system: 'hive', organ: 'swarm', description: 'Multi-tentacle orchestrator' },
  { module: 'urinary', body_system: 'immune', organ: 'kidney', description: 'Cleanup + flush' },
  { module: 'joints', body_system: 'skeleton', organ: 'ligament', description: 'MCP provider joints' },
  { module: 'supervisor', body_system: 'infrastructure', organ: 'spine', description: 'Service health' },
];

// ─── HormoneBus fixtures (SC-2) ────────────────────────────────────────────

/**
 * Mirrors HormoneState in src-tauri/src/homeostasis.rs:28. All 10 fields +
 * last_updated. Used for initial homeostasis_get mock + baseline HORMONE_UPDATE
 * payload.
 */
export const MOCK_HORMONE_STATE = {
  arousal: 0.4,
  energy_mode: 0.7,
  exploration: 0.5,
  trust: 0.6,
  urgency: 0.2,
  hunger: 0.3,
  thirst: 0.35,
  insulin: 0.45,
  adrenaline: 0.15,
  leptin: 0.55,
  last_updated: Date.now(),
};

/** 24-bar circadian profile for homeostasis_get_circadian mock. */
export const MOCK_CIRCADIAN: number[] = Array.from({ length: 24 }, () => 0.5);

// ─── HiveMesh / ApprovalQueue fixtures (SC-3, SC-4) ────────────────────────

/**
 * Matches HiveStatus in src-tauri/src/hive.rs. 5 tentacles (≥ 5 per SC-3
 * explicit falsifier) with varied statuses + 3 recent decisions covering
 * Reply (high-confidence → batch-approve candidate) + Escalate + Act so the
 * ApprovalQueue exercise can click approve-0 and the batch-approve gate.
 */
export const MOCK_HIVE_STATUS = {
  running: true,
  tentacle_count: 10,
  active_tentacles: 8,
  head_count: 4,
  pending_decisions: 3,
  pending_reports: 15,
  last_tick: Math.floor(Date.now() / 1000),
  total_reports_processed: 123,
  total_actions_taken: 45,
  autonomy: 0.3,
  tentacles: [
    {
      id: 'tentacle-github',
      platform: 'github',
      status: 'Active' as const,
      head: 'development',
      last_heartbeat: Math.floor(Date.now() / 1000),
      messages_processed: 10,
      actions_taken: 3,
      pending_report_count: 0,
    },
    {
      id: 'tentacle-slack',
      platform: 'slack',
      status: 'Active' as const,
      head: 'communications',
      last_heartbeat: Math.floor(Date.now() / 1000),
      messages_processed: 5,
      actions_taken: 1,
      pending_report_count: 2,
    },
    {
      id: 'tentacle-email',
      platform: 'email',
      status: 'Dormant' as const,
      head: 'communications',
      last_heartbeat: Math.floor(Date.now() / 1000),
      messages_processed: 0,
      actions_taken: 0,
      pending_report_count: 0,
    },
    {
      id: 'tentacle-discord',
      platform: 'discord',
      status: 'Error' as const,
      head: 'communications',
      last_heartbeat: Math.floor(Date.now() / 1000),
      messages_processed: 0,
      actions_taken: 0,
      pending_report_count: 0,
    },
    {
      id: 'tentacle-linear',
      platform: 'linear',
      status: 'Active' as const,
      head: 'development',
      last_heartbeat: Math.floor(Date.now() / 1000),
      messages_processed: 3,
      actions_taken: 0,
      pending_report_count: 1,
    },
  ],
  recent_decisions: [
    {
      type: 'Reply' as const,
      data: { platform: 'slack', to: '@alice', draft: 'Sure, sounds good.', confidence: 0.9 },
    },
    {
      type: 'Escalate' as const,
      data: { reason: 'Unclear intent', context: 'Manager DM' },
    },
    {
      type: 'Act' as const,
      data: { action: 'close_issue', platform: 'github', reversible: true },
    },
  ],
};
