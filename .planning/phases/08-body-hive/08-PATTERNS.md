# Phase 8 Patterns — Recurring Recipes

**Mapped:** 2026-04-18
**Scope:** Code recipes Phase 8 implementers MUST follow verbatim (or cite a deviation in their commit message).

**IMPORTANT:** Phase 8 is a structural mirror of Phase 5 + Phase 6 + Phase 7 (compressed 7→5 plans). Patterns §1..§10 in `.planning/phases/05-agents-knowledge/05-PATTERNS.md`, `.planning/phases/06-life-os-identity/06-PATTERNS.md`, and `.planning/phases/07-dev-tools-admin/07-PATTERNS.md` apply verbatim — only the cluster names change (dev-tools → body; admin → hive). This file captures ONLY the Phase-8-specific recipes that diverge or extend prior patterns.

---

## 1. Typed wrapper per Rust command — cluster-scoped (inherits Phase 5 §1 + Phase 6 §1 + Phase 7 §1)

Same recipe as Plan 05-02 / 06-02 / 07-02. Two new wrapper files:

```ts
// src/lib/tauri/body.ts (Plan 08-02)
import { invokeTyped } from './_base';

// Re-export homeostasis wrappers for convenience (D-194).
export * as homeostasis from './homeostasis';

// ─── Types (mirror Rust Serialize shape exactly — snake_case returns preserved) ───

export interface ModuleMapping {
  module: string;
  body_system: string;
  organ: string;
  description: string;
  [k: string]: unknown;
}

export interface OrganCapability {
  action: string;
  description: string;
  mutating: boolean;
  autonomy_level: number; // 0-5
  [k: string]: unknown;
}

export interface OrganStatus {
  name: string;
  health: string; // 'active' | 'dormant' | 'error' | 'disconnected'
  summary: string;
  recent_observations: string[];
  capabilities: OrganCapability[];
  [k: string]: unknown;
}

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

export interface GitRepoState {
  path: string;
  branch: string;
  uncommitted: number;
  untracked: number;
  ahead: number;
  last_commit: string;
  [k: string]: unknown;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  [k: string]: unknown;
}

export interface PortInfo {
  port: number;
  service?: string;
  local_addr?: string;
  [k: string]: unknown;
}

export interface FileChange {
  path: string;
  kind: string; // 'created' | 'modified' | 'deleted'
  timestamp: number;
  [k: string]: unknown;
}

export interface SystemLoad {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  [k: string]: unknown;
}

export interface TodoItem {
  id: string;
  text: string;
  priority?: string;
  [k: string]: unknown;
}

// ─── Wrappers (one per command; JSDoc cites Rust file:line) ────────────────

/** @see src-tauri/src/body_registry.rs:239 body_get_map */
export function bodyGetMap(): Promise<ModuleMapping[]> {
  return invokeTyped<ModuleMapping[]>('body_get_map', {});
}

/** @see src-tauri/src/body_registry.rs:244 body_get_system */
export function bodyGetSystem(args: { system: string }): Promise<ModuleMapping[]> {
  return invokeTyped<ModuleMapping[]>('body_get_system', { system: args.system });
}

/** @see src-tauri/src/body_registry.rs:249 body_get_summary */
export function bodyGetSummary(): Promise<Array<[string, number]>> {
  return invokeTyped<Array<[string, number]>>('body_get_summary', {});
}

/** @see src-tauri/src/organ.rs:361 organ_get_registry */
export function organGetRegistry(): Promise<OrganStatus[]> {
  return invokeTyped<OrganStatus[]>('organ_get_registry', {});
}

/** @see src-tauri/src/organ.rs:366 organ_get_roster */
export function organGetRoster(): Promise<string> {
  return invokeTyped<string>('organ_get_roster', {});
}

/** @see src-tauri/src/organ.rs:371 organ_set_autonomy */
export function organSetAutonomy(args: { organ: string; action: string; level: number }): Promise<void> {
  return invokeTyped<void>('organ_set_autonomy', {
    organ: args.organ,
    action: args.action,
    level: args.level,
  });
}

/** @see src-tauri/src/organ.rs:380 organ_get_autonomy */
export function organGetAutonomy(args: { organ: string; action: string }): Promise<number> {
  return invokeTyped<number>('organ_get_autonomy', {
    organ: args.organ,
    action: args.action,
  });
}

/** @see src-tauri/src/dna.rs:495 dna_get_identity */
export function dnaGetIdentity(): Promise<string> {
  return invokeTyped<string>('dna_get_identity', {});
}

/** @see src-tauri/src/dna.rs:500 dna_get_goals */
export function dnaGetGoals(): Promise<string> {
  return invokeTyped<string>('dna_get_goals', {});
}

/** @see src-tauri/src/dna.rs:505 dna_get_patterns */
export function dnaGetPatterns(): Promise<string> {
  return invokeTyped<string>('dna_get_patterns', {});
}

/** @see src-tauri/src/dna.rs:510 dna_query */
export function dnaQuery(args: { query: string }): Promise<string> {
  return invokeTyped<string>('dna_query', { query: args.query });
}

/** @see src-tauri/src/world_model.rs:1019 world_get_state */
export function worldGetState(): Promise<WorldState> {
  return invokeTyped<WorldState>('world_get_state', {});
}

/** @see src-tauri/src/world_model.rs:1024 world_get_summary */
export function worldGetSummary(): Promise<string> {
  return invokeTyped<string>('world_get_summary', {});
}

/** @see src-tauri/src/world_model.rs:1029 world_refresh */
export function worldRefresh(): Promise<WorldState> {
  return invokeTyped<WorldState>('world_refresh', {});
}

// ─── Body-system drill-in commands (cardio/urinary/reproductive/joints) ────

/** @see src-tauri/src/cardiovascular.rs:304 cardio_get_blood_pressure */
export function cardioGetBloodPressure(): Promise<BloodPressure> {
  return invokeTyped<BloodPressure>('cardio_get_blood_pressure', {});
}

/** @see src-tauri/src/cardiovascular.rs:309 cardio_get_event_registry */
export function cardioGetEventRegistry(): Promise<EventInfo[]> {
  return invokeTyped<EventInfo[]>('cardio_get_event_registry', {});
}

/** @see src-tauri/src/cardiovascular.rs:315 blade_vital_signs */
export function bladeVitalSigns(): Promise<VitalSigns> {
  return invokeTyped<VitalSigns>('blade_vital_signs', {});
}

/** @see src-tauri/src/urinary.rs:204 urinary_flush */
export function urinaryFlush(): Promise<number> {
  return invokeTyped<number>('urinary_flush', {});
}

/** @see src-tauri/src/urinary.rs:209 immune_get_status */
export function immuneGetStatus(): Promise<ImmuneStatus> {
  return invokeTyped<ImmuneStatus>('immune_get_status', {});
}

/** @see src-tauri/src/reproductive.rs:217 reproductive_get_dna */
export function reproductiveGetDna(): Promise<InheritedDna> {
  return invokeTyped<InheritedDna>('reproductive_get_dna', {});
}

/** @see src-tauri/src/reproductive.rs:222 reproductive_spawn */
export function reproductiveSpawn(args: { agentType: string; initialTask?: string }): Promise<string> {
  return invokeTyped<string>('reproductive_spawn', {
    agent_type: args.agentType,
    initial_task: args.initialTask,
  });
}

/** @see src-tauri/src/joints.rs:285 joints_list_providers */
export function jointsListProviders(): Promise<string[]> {
  return invokeTyped<string[]>('joints_list_providers', {});
}

/** @see src-tauri/src/joints.rs:294 joints_list_stores */
export function jointsListStores(): Promise<string[]> {
  return invokeTyped<string[]>('joints_list_stores', {});
}

// ─── Supporting types (mirror Rust structs) ────────────────────────────────

export interface BloodPressure { systolic: number; diastolic: number; [k: string]: unknown; }
export interface EventInfo { name: string; direction: string; system: string; description: string; [k: string]: unknown; }
export interface VitalSigns { overall_health: string; hormone_level?: string; [k: string]: unknown; }
export interface ImmuneStatus { status: string; [k: string]: unknown; }
export interface InheritedDna { [k: string]: unknown; }
```

```ts
// src/lib/tauri/hive.ts (Plan 08-02)
import { invokeTyped } from './_base';

// ─── Enum types (Rust-side Serialize-as-string — mirror as TS union) ───────

export type TentacleStatus = 'Active' | 'Dormant' | 'Error' | 'Disconnected';
export type Priority = 'Critical' | 'High' | 'Normal' | 'Low';

// ─── Types (mirror Rust Serialize shape exactly) ───────────────────────────

export interface TentacleReport {
  id: string;
  tentacle_id: string;
  timestamp: number;
  priority: Priority;
  category: string; // 'message' | 'mention' | 'alert' | 'update' | 'action_needed'
  summary: string;
  details: unknown; // serde_json::Value
  requires_action: boolean;
  suggested_action: string | null;
  processed: boolean;
  [k: string]: unknown;
}

export type Decision =
  | { type: 'Reply'; data: { platform: string; to: string; draft: string; confidence: number } }
  | { type: 'Escalate'; data: { reason: string; context: string } }
  | { type: 'Act'; data: { action: string; platform: string; reversible: boolean } }
  | { type: 'Inform'; data: { summary: string } };

export interface TentacleSummary {
  id: string;
  platform: string;
  status: TentacleStatus;
  head: string;
  last_heartbeat: number;
  messages_processed: number;
  actions_taken: number;
  pending_report_count: number;
  [k: string]: unknown;
}

export interface HiveStatus {
  running: boolean;
  tentacle_count: number;
  active_tentacles: number;
  head_count: number;
  pending_decisions: number;
  pending_reports: number;
  last_tick: number;
  total_reports_processed: number;
  total_actions_taken: number;
  autonomy: number;
  tentacles: TentacleSummary[];
  recent_decisions: Decision[];
  [k: string]: unknown;
}

// ─── Wrappers (one per command; JSDoc cites Rust file:line) ────────────────

/** @see src-tauri/src/hive.rs:3296 hive_start */
export function hiveStart(): Promise<HiveStatus> {
  return invokeTyped<HiveStatus>('hive_start', {});
}

/** @see src-tauri/src/hive.rs:3305 hive_stop */
export function hiveStop(): Promise<void> {
  return invokeTyped<void>('hive_stop', {});
}

/** @see src-tauri/src/hive.rs:3311 hive_get_status */
export function hiveGetStatus(): Promise<HiveStatus> {
  return invokeTyped<HiveStatus>('hive_get_status', {});
}

/** @see src-tauri/src/hive.rs:3252 hive_get_digest */
export function hiveGetDigest(): Promise<string> {
  return invokeTyped<string>('hive_get_digest', {});
}

/** @see src-tauri/src/hive.rs:3316 hive_spawn_tentacle */
export function hiveSpawnTentacle(args: { platform: string; config: unknown }): Promise<void> {
  return invokeTyped<void>('hive_spawn_tentacle', {
    platform: args.platform,
    config: args.config,
  });
}

/** @see src-tauri/src/hive.rs:3324 hive_get_reports */
export function hiveGetReports(): Promise<TentacleReport[]> {
  return invokeTyped<TentacleReport[]>('hive_get_reports', {});
}

/** @see src-tauri/src/hive.rs:3329 hive_approve_decision */
export function hiveApproveDecision(args: { headId: string; decisionIndex: number }): Promise<void> {
  return invokeTyped<void>('hive_approve_decision', {
    head_id: args.headId,
    decision_index: args.decisionIndex,
  });
}

/** @see src-tauri/src/hive.rs:3337 hive_set_autonomy */
export function hiveSetAutonomy(args: { level: number }): Promise<void> {
  return invokeTyped<void>('hive_set_autonomy', { level: args.level });
}

// ─── AI Delegate ──────────────────────────────────────────────────────────

/** @see src-tauri/src/ai_delegate.rs:167 ai_delegate_introduce */
export function aiDelegateIntroduce(): Promise<string> {
  return invokeTyped<string>('ai_delegate_introduce', {});
}

/** @see src-tauri/src/ai_delegate.rs:177 ai_delegate_check */
export function aiDelegateCheck(): Promise<AiDelegateInfo> {
  return invokeTyped<AiDelegateInfo>('ai_delegate_check', {});
}

export interface AiDelegateInfo {
  name: string;
  available: boolean;
  reasoning?: string;
  [k: string]: unknown;
}
```

**Rules (same as Phase 5/6/7 §1):**
- One wrapper per `#[tauri::command]`. No multiplexing.
- Arg keys in invoke call MUST be snake_case. Wrapper signature MAY expose camelCase.
- Return types are hand-written interfaces in the SAME file.
- ESLint `no-raw-tauri` enforced.
- **File size budget:** body.ts ≈ 350-450 lines (~22 wrappers × ~12 lines avg with types). hive.ts ≈ 200-300 lines (~11 wrappers + 4 enum+interface types).

---

## 2. Cluster index rewrite (Plan 08-02 — ONE-WRITE rule, inherits Phase 5 §5 + Phase 6 §2 + Phase 7 §2)

```tsx
// src/features/body/index.tsx (Plan 08-02 rewrites — final form)
// Phase 8: replaces Phase 1 skeletons with lazy imports of real route components.
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-199

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const BodyMap          = lazy(() => import('./BodyMap').then((m) => ({ default: m.BodyMap })));
const BodySystemDetail = lazy(() => import('./BodySystemDetail').then((m) => ({ default: m.BodySystemDetail })));
const HormoneBus       = lazy(() => import('./HormoneBus').then((m) => ({ default: m.HormoneBus })));
const OrganRegistry    = lazy(() => import('./OrganRegistry').then((m) => ({ default: m.OrganRegistry })));
const DNA              = lazy(() => import('./DNA').then((m) => ({ default: m.DNA })));
const WorldModel       = lazy(() => import('./WorldModel').then((m) => ({ default: m.WorldModel })));

export const routes: RouteDefinition[] = [
  { id: 'body-map',           label: 'Body Map',           section: 'body', component: BodyMap,          phase: 8 },
  { id: 'body-system-detail', label: 'Body System Detail', section: 'body', component: BodySystemDetail, phase: 8 },
  { id: 'hormone-bus',        label: 'Hormone Bus',        section: 'body', component: HormoneBus,       phase: 8 },
  { id: 'organ-registry',     label: 'Organ Registry',     section: 'body', component: OrganRegistry,    phase: 8 },
  { id: 'dna',                label: 'DNA',                section: 'body', component: DNA,              phase: 8 },
  { id: 'world-model',        label: 'World Model',        section: 'body', component: WorldModel,       phase: 8 },
];
```

```tsx
// src/features/hive/index.tsx (Plan 08-02 rewrites — final form)
import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const HiveMesh         = lazy(() => import('./HiveMesh').then((m) => ({ default: m.HiveMesh })));
const TentacleDetail   = lazy(() => import('./TentacleDetail').then((m) => ({ default: m.TentacleDetail })));
const AutonomyControls = lazy(() => import('./AutonomyControls').then((m) => ({ default: m.AutonomyControls })));
const ApprovalQueue    = lazy(() => import('./ApprovalQueue').then((m) => ({ default: m.ApprovalQueue })));
const AiDelegate       = lazy(() => import('./AiDelegate').then((m) => ({ default: m.AiDelegate })));

export const routes: RouteDefinition[] = [
  { id: 'hive-mesh',           label: 'Hive',              section: 'hive', component: HiveMesh,         phase: 8, description: 'All tentacles overview' },
  { id: 'hive-tentacle',       label: 'Tentacle Detail',   section: 'hive', component: TentacleDetail,   phase: 8 },
  { id: 'hive-autonomy',       label: 'Autonomy Controls', section: 'hive', component: AutonomyControls, phase: 8 },
  { id: 'hive-approval-queue', label: 'Approval Queue',    section: 'hive', component: ApprovalQueue,    phase: 8 },
  { id: 'hive-ai-delegate',    label: 'AI Delegate',       section: 'hive', component: AiDelegate,       phase: 8 },
];
```

**Rules:**
- Plan 08-02 is the SINGLE writer of these two index.tsx files.
- Plans 08-03 / 08-04 each CREATE a disjoint subset of per-route files; file ownership is exclusive.
- Route id + label order preserved from Phase 1 substrate so NavRail ordering doesn't shift.

---

## 3. HormoneBus bar-meter recipe (Plan 08-03 HormoneBus surface)

Text-first hormone visualization. NO SVG or chart library (D-201).

```tsx
// src/features/body/HormoneBus.tsx (Plan 08-03) — pattern reference
import { useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog } from '@/design-system/primitives';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import {
  homeostasisGet,
  homeostasisGetCircadian,
  homeostasisGetDirective,
  homeostasisRelearnCircadian,
} from '@/lib/tauri/homeostasis';
import type { HormoneState } from '@/types/hormones';
import './body.css';

const HORMONES: Array<{ key: keyof HormoneState; label: string; accent: 'red' | 'green' | 'blue' | 'purple' | 'neutral' }> = [
  { key: 'arousal', label: 'Arousal', accent: 'red' },
  { key: 'energy_mode', label: 'Energy', accent: 'green' },
  { key: 'exploration', label: 'Exploration', accent: 'blue' },
  { key: 'trust', label: 'Trust', accent: 'green' },
  { key: 'urgency', label: 'Urgency', accent: 'red' },
  // + 5 more derived from HormoneState struct
];

export function HormoneBus() {
  const [state, setState] = useState<HormoneState | null>(null);
  const [circadian, setCircadian] = useState<number[]>([]);

  useEffect(() => {
    homeostasisGet().then(setState);
    homeostasisGetCircadian().then(setCircadian);
  }, []);

  useTauriEvent<HormoneState>(BLADE_EVENTS.HORMONE_UPDATE, (e) => setState(e.payload));

  if (!state) return <GlassPanel>Loading hormones…</GlassPanel>;

  const dominant = HORMONES.reduce((a, b) => ((state[b.key] as number) > (state[a.key] as number) ? b : a));

  return (
    <div className="hormone-bus" data-testid="hormone-bus-root">
      <GlassPanel className="hormone-bus-grid">
        {HORMONES.map((h) => (
          <div key={h.key} className={`hormone-row accent-${h.accent}`} data-testid={`hormone-row-${h.key}`}>
            <span className="hormone-label">{h.label}</span>
            <div className="hormone-meter"><div style={{ width: `${((state[h.key] as number) * 100).toFixed(0)}%` }} /></div>
            <span className="hormone-value">{((state[h.key] as number) ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </GlassPanel>
      <GlassPanel>
        <div className="hormone-dominant" data-testid="hormone-dominant">Dominant: <b>{dominant.label}</b></div>
      </GlassPanel>
      <GlassPanel>
        <div className="circadian-grid" data-testid="circadian-grid">
          {circadian.map((v, hour) => (
            <div key={hour} className="circadian-bar" style={{ height: `${(v * 100).toFixed(0)}%` }} title={`${hour}:00 — ${v.toFixed(2)}`} />
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
```

**Rules:**
- No SVG / chart library — CSS flex + `height` / `width` percentages only.
- Color accents map to status tokens (red = `--status-error`, green = `--status-success`, etc.) — no hardcoded hex.
- `useTauriEvent(HORMONE_UPDATE)` for live; initial render from `homeostasisGet()`.

---

## 4. HiveMesh tentacle-card grid + live-subscription recipe (Plan 08-04 HiveMesh surface)

```tsx
// src/features/hive/HiveMesh.tsx (Plan 08-04) — pattern reference
import { useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog } from '@/design-system/primitives';
import { useRouterCtx } from '@/windows/main/useRouter';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import { hiveGetStatus, hiveSetAutonomy } from '@/lib/tauri/hive';
import type { HiveStatus, TentacleSummary } from '@/lib/tauri/hive';
import './hive.css';

export function HiveMesh() {
  const router = useRouterCtx();
  const { setPref } = usePrefs();
  const toast = useToast();
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [showAutoDialog, setShowAutoDialog] = useState<null | { level: number }>(null);

  useEffect(() => { hiveGetStatus().then(setStatus); }, []);

  useTauriEvent<HiveStatus>(BLADE_EVENTS.HIVE_TICK, (e) => setStatus(e.payload));
  useTauriEvent(BLADE_EVENTS.HIVE_ACTION, (e) => toast.show({ title: 'Hive acted', description: String((e.payload as { description?: string })?.description ?? ''), kind: 'success' }));
  useTauriEvent(BLADE_EVENTS.HIVE_INFORM, (e) => toast.show({ title: 'Hive', description: String((e.payload as { summary?: string })?.summary ?? ''), kind: 'info' }));
  useTauriEvent(BLADE_EVENTS.HIVE_CI_FAILURE, () => toast.show({ title: 'CI Failure detected', kind: 'error' }));

  const handleAutonomyChange = (level: number) => {
    if (level >= 0.7) setShowAutoDialog({ level });
    else hiveSetAutonomy({ level }).catch((err) => toast.show({ title: 'Set autonomy failed', description: String(err), kind: 'error' }));
  };

  const confirmAutonomy = async () => {
    if (!showAutoDialog) return;
    await hiveSetAutonomy({ level: showAutoDialog.level });
    toast.show({ title: `Autonomy ${showAutoDialog.level.toFixed(1)}`, kind: 'success' });
    setShowAutoDialog(null);
  };

  if (!status) return <GlassPanel>Loading hive…</GlassPanel>;

  return (
    <div className="hive-mesh" data-testid="hive-mesh-root">
      <GlassPanel className="hive-hero">
        <div>Running: {String(status.running)}</div>
        <div>Autonomy: {status.autonomy.toFixed(2)}</div>
        <input type="range" min={0} max={1} step={0.05} value={status.autonomy} onChange={(e) => handleAutonomyChange(parseFloat(e.target.value))} data-testid="hive-autonomy-slider" />
        <div>Reports: {status.total_reports_processed} · Actions: {status.total_actions_taken}</div>
      </GlassPanel>

      <div className="tentacle-grid" data-testid="tentacle-grid">
        {status.tentacles.map((t: TentacleSummary) => (
          <button
            key={t.id}
            className={`tentacle-card status-${t.status.toLowerCase()}`}
            onClick={() => { setPref('hive.activeTentacle', t.platform); router.openRoute('hive-tentacle'); }}
            data-testid={`tentacle-card-${t.platform}`}
          >
            <div className="tentacle-platform">{t.platform}</div>
            <div className="tentacle-status">{t.status}</div>
            <div className="tentacle-head">→ {t.head}</div>
            <div className="tentacle-reports">{t.pending_report_count} reports</div>
          </button>
        ))}
      </div>

      {showAutoDialog && (
        <Dialog open onClose={() => setShowAutoDialog(null)} title={`Set hive autonomy to ${showAutoDialog.level.toFixed(2)}?`}>
          <p>Autonomy ≥ 0.7 allows the hive to act without asking first on most decisions. Confirm?</p>
          <div><Button onClick={confirmAutonomy}>Confirm</Button><Button variant="ghost" onClick={() => setShowAutoDialog(null)}>Cancel</Button></div>
        </Dialog>
      )}
    </div>
  );
}
```

**Rules:**
- Subscribe to HIVE_TICK, HIVE_ACTION, HIVE_INFORM, HIVE_CI_FAILURE — update status on tick, toast on others.
- Status-class CSS (`status-active`, `status-dormant`, `status-error`, `status-disconnected`) maps to status tokens verbatim.
- Dialog-gate autonomy ≥ 0.7 (D-204).
- `setPref('hive.activeTentacle', platform)` + `router.openRoute('hive-tentacle')` = canonical route handoff (D-210).

---

## 5. ApprovalQueue decision-card recipe (Plan 08-04 ApprovalQueue surface)

```tsx
// src/features/hive/ApprovalQueue.tsx (Plan 08-04) — pattern reference
import { useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import { hiveGetStatus, hiveApproveDecision } from '@/lib/tauri/hive';
import type { Decision } from '@/lib/tauri/hive';
import './hive.css';

interface PendingRow {
  headId: string;
  decisionIndex: number;
  decision: Decision;
}

export function ApprovalQueue() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [batchDialog, setBatchDialog] = useState<null | { count: number }>(null);

  const refresh = () => hiveGetStatus().then((s) => {
    const flat: PendingRow[] = [];
    // HiveStatus doesn't surface heads[].pending_decisions directly; reconstruct via
    // recent_decisions filtered against pending_decisions count — or adjust hiveGetStatus
    // return shape as documented in D-205. For V1, treat recent_decisions as the queue.
    s.recent_decisions.forEach((d, i) => flat.push({ headId: 'combined', decisionIndex: i, decision: d }));
    setRows(flat);
  });

  useEffect(() => { refresh(); }, []);
  useTauriEvent(BLADE_EVENTS.HIVE_PENDING_DECISIONS, refresh);
  useTauriEvent(BLADE_EVENTS.HIVE_ESCALATE, (e) => toast.show({ title: 'Hive escalation', description: String((e.payload as { reason?: string })?.reason ?? ''), kind: 'warning' }));
  useTauriEvent(BLADE_EVENTS.HIVE_ACTION_DEFERRED, refresh);

  const approve = async (r: PendingRow) => {
    await hiveApproveDecision({ headId: r.headId, decisionIndex: r.decisionIndex });
    toast.show({ title: 'Approved', kind: 'success' });
    refresh();
  };

  const reject = (r: PendingRow) => {
    setRows(prev => prev.filter(x => !(x.headId === r.headId && x.decisionIndex === r.decisionIndex)));
    toast.show({ title: 'Dismissed (client-side — backend reject not yet available)', kind: 'info' });
  };

  const lowRisk = rows.filter(r => r.decision.type === 'Reply' && r.decision.data.confidence > 0.8);
  const batchApproveLowRisk = async () => {
    for (const r of lowRisk) await hiveApproveDecision({ headId: r.headId, decisionIndex: r.decisionIndex });
    toast.show({ title: `Batch approved ${lowRisk.length} low-risk`, kind: 'success' });
    setBatchDialog(null);
    refresh();
  };

  return (
    <div className="approval-queue" data-testid="approval-queue-root">
      <GlassPanel>
        <Button onClick={() => setBatchDialog({ count: lowRisk.length })} disabled={lowRisk.length === 0}>
          Approve all low-risk ({lowRisk.length})
        </Button>
      </GlassPanel>
      {rows.map((r) => (
        <GlassPanel key={`${r.headId}-${r.decisionIndex}`} data-testid={`approval-row-${r.decisionIndex}`}>
          <div className="decision-type">{r.decision.type}</div>
          <pre className="decision-details">{JSON.stringify(r.decision.data, null, 2)}</pre>
          <div className="decision-actions">
            <Button onClick={() => approve(r)}>Approve</Button>
            <Button variant="ghost" onClick={() => reject(r)}>Dismiss</Button>
          </div>
        </GlassPanel>
      ))}
      {batchDialog && (
        <Dialog open onClose={() => setBatchDialog(null)} title={`Approve ${batchDialog.count} low-risk decisions?`}>
          <Button onClick={batchApproveLowRisk}>Confirm</Button>
          <Button variant="ghost" onClick={() => setBatchDialog(null)}>Cancel</Button>
        </Dialog>
      )}
    </div>
  );
}
```

**Rules:**
- Subscribe to HIVE_PENDING_DECISIONS + HIVE_ESCALATE + HIVE_ACTION_DEFERRED.
- Reject is CLIENT-SIDE ONLY (flagged in SUMMARY; backend command absent).
- Batch-approve Dialog-gates above threshold count.

---

## 6. Cross-cluster import recipe (Phase 8 specific — D-196)

```tsx
// src/features/body/BodySystemDetail.tsx (Plan 08-03)
import { supervisorGetHealth } from '@/lib/tauri/admin'; // ← cross-cluster import
import { homeostasisGet } from '@/lib/tauri/homeostasis'; // ← cross-cluster import (Phase 3 file)
import { bodyGetSystem, cardioGetBloodPressure, urinaryFlush, immuneGetStatus } from '@/lib/tauri/body';
```

**Rules:**
- Cross-cluster imports are ALLOWED when wrapping the same Rust command would create duplication (D-194 + D-196 last bullet).
- Phase 8 SUMMARY explicitly lists cross-cluster imports so the graph is easy to audit.
- Never IMPORT a feature folder from another cluster; only wrapper files (`src/lib/tauri/*.ts`).

---

## 7. Playwright spec recipe (Plan 08-05 — inherits Phase 5 §7 + Phase 6 §8 + Phase 7 §7)

```ts
// tests/e2e/body-map.spec.ts (Plan 08-05) — pattern reference
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_INVOKE_HOOK__ = (cmd: string) => {
      if (cmd === 'body_get_summary') return [['nervous', 19], ['vision', 7], ['audio', 10]];
      if (cmd === 'body_get_system') return [{ module: 'brain', body_system: 'nervous', organ: 'cerebrum', description: 'System prompt assembly' }];
      return null;
    };
  });
});

test('BodyMap renders 12 system cards + click drills into detail', async ({ page }) => {
  await page.goto('/#/body-map');
  const root = page.getByTestId('body-map-root');
  await expect(root).toBeVisible();
  const cards = page.locator('[data-testid^="body-system-card-"]');
  await expect(cards).not.toHaveCount(0);
  await cards.first().click();
  await expect(page.getByTestId('body-system-detail-root')).toBeVisible();
});
```

**Rules:**
- Mock Tauri invokes via `__TAURI_INVOKE_HOOK__` (Phase 5 harness).
- Assert data-testid mounts + live data reflects mock.
- ≥ 4 specs per phase (one per ROADMAP SC).

---

## 8. Verify script recipe (Plan 08-05 — inherits Phase 5 §8 + Phase 6 §9 + Phase 7 §8)

```bash
#!/usr/bin/env bash
# scripts/verify-phase8-rust-surface.sh
# Asserts every Phase 8 Rust command is still registered (D-200 defensive guard).

set -euo pipefail

LIB=src-tauri/src/lib.rs
REQUIRED=(
  "body_registry::body_get_map"
  "body_registry::body_get_system"
  "body_registry::body_get_summary"
  "homeostasis::homeostasis_get"
  "homeostasis::homeostasis_get_directive"
  "homeostasis::homeostasis_get_circadian"
  "homeostasis::homeostasis_relearn_circadian"
  "organ::organ_get_registry"
  "organ::organ_get_roster"
  "organ::organ_set_autonomy"
  "organ::organ_get_autonomy"
  "dna::dna_get_identity"
  "dna::dna_get_goals"
  "dna::dna_get_patterns"
  "dna::dna_query"
  "world_model::world_get_state"
  "world_model::world_get_summary"
  "world_model::world_refresh"
  "cardiovascular::cardio_get_blood_pressure"
  "cardiovascular::cardio_get_event_registry"
  "cardiovascular::blade_vital_signs"
  "urinary::urinary_flush"
  "urinary::immune_get_status"
  "reproductive::reproductive_get_dna"
  "reproductive::reproductive_spawn"
  "joints::joints_list_providers"
  "joints::joints_list_stores"
  "hive::hive_start"
  "hive::hive_stop"
  "hive::hive_get_status"
  "hive::hive_get_digest"
  "hive::hive_spawn_tentacle"
  "hive::hive_get_reports"
  "hive::hive_approve_decision"
  "hive::hive_set_autonomy"
  "ai_delegate::ai_delegate_introduce"
  "ai_delegate::ai_delegate_check"
)

MISSING=()
for cmd in "${REQUIRED[@]}"; do
  if ! grep -qF "$cmd" "$LIB"; then
    MISSING+=("$cmd")
  fi
done

if (( ${#MISSING[@]} > 0 )); then
  echo "❌ verify-phase8-rust-surface: MISSING commands from $LIB:"
  printf '   - %s\n' "${MISSING[@]}"
  exit 1
fi

echo "✓ verify-phase8-rust-surface: all ${#REQUIRED[@]} Phase 8 commands registered."
```

**Rules:**
- Idempotent, shellcheck-clean.
- Registered in `package.json` scripts as `verify:phase8-rust`.
- Composed into `verify:all` after Phase 5/6/7 scripts.

---

## 9. CSS structure (inherits Phase 5 §10 + Phase 6 §10 + Phase 7 §10)

```css
/* src/features/body/body.css */
@layer features-body {
  .body-map { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); padding: var(--space-4); }
  .body-system-card { /* ... */ }

  .hormone-bus { display: grid; grid-template-columns: 2fr 1fr 2fr; gap: var(--space-4); padding: var(--space-4); }
  .hormone-row { display: grid; grid-template-columns: 100px 1fr 60px; align-items: center; gap: var(--space-3); }
  .hormone-meter { height: 8px; background: var(--glass-1-bg); border-radius: 4px; overflow: hidden; }
  .hormone-meter > div { height: 100%; background: var(--status-running); transition: width 250ms ease; }
  .hormone-row.accent-red .hormone-meter > div { background: var(--status-error); }
  .hormone-row.accent-green .hormone-meter > div { background: var(--status-success); }

  .circadian-grid { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
  .circadian-bar { flex: 1; background: var(--status-running); min-height: 2%; transition: height 250ms ease; }

  .dna-tabs { /* inherits tabbed-surface pattern */ }
}
```

```css
/* src/features/hive/hive.css */
@layer features-hive {
  .hive-mesh { display: grid; grid-template-rows: auto 1fr auto; gap: var(--space-4); padding: var(--space-4); }
  .hive-hero { /* ... */ }
  .tentacle-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-3); }
  .tentacle-card { padding: var(--space-3); border-radius: var(--radius-md); background: var(--glass-1-bg); }
  .tentacle-card.status-active { border-color: var(--status-success); }
  .tentacle-card.status-dormant { opacity: 0.6; }
  .tentacle-card.status-error { border-color: var(--status-error); background: rgba(239, 68, 68, 0.08); }
  .tentacle-card.status-disconnected { border-color: var(--status-idle); }

  .autonomy-matrix { display: grid; grid-template-columns: 160px repeat(6, 1fr); gap: 2px; }
  .autonomy-matrix input[type="range"] { width: 100%; }

  .approval-queue { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
  .decision-type { font-weight: var(--font-weight-semibold); color: var(--text-primary); }
  .decision-details { font-family: var(--font-mono); font-size: 12px; background: var(--glass-1-bg); padding: var(--space-2); border-radius: var(--radius-sm); max-height: 200px; overflow: auto; }
}
```

**Rules:**
- One `@layer features-{cluster}` per cluster file.
- Use Phase 1 tokens (`--glass-*-bg`, `--status-*`, `--space-*`, `--radius-*`, `--font-*`).
- No hardcoded colors except danger-banner `rgba(239, 68, 68, 0.08)` per Phase 7 D-183.

---

## 10. Cross-cluster test data fixtures (Plan 08-05)

Playwright specs mock Tauri invokes per spec. Shared fixtures:

```ts
// tests/e2e/_fixtures/hive-status.ts (Plan 08-05)
export const MOCK_HIVE_STATUS = {
  running: true,
  tentacle_count: 10,
  active_tentacles: 8,
  head_count: 4,
  pending_decisions: 3,
  pending_reports: 15,
  last_tick: Date.now() / 1000,
  total_reports_processed: 123,
  total_actions_taken: 45,
  autonomy: 0.3,
  tentacles: [
    { id: 'tentacle-github', platform: 'github', status: 'Active', head: 'development', last_heartbeat: Date.now() / 1000, messages_processed: 10, actions_taken: 3, pending_report_count: 0 },
    // ...
  ],
  recent_decisions: [
    { type: 'Reply', data: { platform: 'slack', to: '@alice', draft: 'Sure, sounds good.', confidence: 0.9 } },
    // ...
  ],
};
```

**Rules:**
- Fixtures in `tests/e2e/_fixtures/`.
- Re-used across specs to reduce boilerplate.

---

*Phase 8 patterns: 2026-04-18.*
