# Phase 5 Patterns — Recurring Recipes

**Mapped:** 2026-04-19
**Scope:** Code recipes Phase 5 implementers MUST follow verbatim (or cite a deviation in their commit message).

---

## 1. Typed wrapper per Rust command (extend existing pattern)

The Phase 1..4 discipline is already locked: `invokeTyped<TReturn, TArgs>(command, args)` with JSDoc `@see` citation. Phase 5 cluster wrappers follow the same recipe, with one addition — cluster-scoped camelCase → snake_case arg conversion at the wrapper boundary.

```ts
// src/lib/tauri/agents.ts (Plan 05-02)
import { invokeTyped } from './_base';

// ─── Types (mirror Rust Serialize shape exactly — snake_case returns preserved) ───
export interface Agent {
  id: string;
  role: string;                 // Rust AgentRole → string via serde
  status: 'pending' | 'running' | 'complete' | 'failed' | 'paused';
  task_description: string;     // snake_case from Rust — DO NOT rename
  started_at?: number;
  progress?: number;
  [k: string]: unknown;         // forward-compat
}

export interface AgentSpawnArgs {
  agentType: string;            // camelCase on JS side; translated at wrapper boundary
  taskDescription: string;
  priority?: 'low' | 'normal' | 'high';
}

// ─── Wrappers (one per command; JSDoc cites Rust file:line) ────────────────
/** @see src-tauri/src/agent_commands.rs:228 agent_create */
export function agentCreate(args: AgentSpawnArgs): Promise<Agent> {
  return invokeTyped('agent_create', {
    agent_type: args.agentType,
    task_description: args.taskDescription,
    priority: args.priority,
  });
}

/** @see src-tauri/src/agent_commands.rs:2605 agent_list */
export function agentList(): Promise<Agent[]> {
  return invokeTyped('agent_list', {});
}

/** @see src-tauri/src/swarm_commands.rs:541 swarm_list */
export function swarmList(limit?: number): Promise<Swarm[]> {
  return invokeTyped('swarm_list', { limit });
}
```

**Rules:**
- One wrapper per `#[tauri::command]` in lib.rs. No multiplexing.
- Arg keys in invoke call MUST be snake_case. Wrapper signature MAY expose camelCase to caller.
- Return types are hand-written interfaces in the SAME file. Mirror Rust struct field names verbatim (snake_case on the wire).
- ESLint `no-raw-tauri` rule blocks any `import { invoke } from '@tauri-apps/api/core'` outside `src/lib/tauri/`.
- File size budget: agents.ts ≈ 400-600 lines (30+ wrappers × 5-10 lines each). knowledge.ts ≈ 600-800 lines (50+ wrappers).

---

## 2. Event subscription for multi-event surfaces (AgentDetail pattern)

AgentDetail subscribes 10 agent events + consolidates into a single rAF-flushed timeline state (D-125 + D-129 + D-135 + D-68 pattern).

```tsx
// src/features/agents/AgentDetail.tsx (Plan 05-03)
import { useEffect, useRef, useState } from 'react';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import type { AgentEventPayload } from '@/lib/events/payloads';
import type { AgentStepStartedPayload, AgentStepCompletedPayload /* ... */ } from '@/lib/events/payloads';

interface TimelineRow {
  seq: number;
  ts: number;
  event: string;     // BLADE_EVENTS.X value
  agentId: string;
  preview: string;   // ≤80 chars of payload.JSON.stringify
}

function useAgentTimeline(currentAgentId: string | null) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const bufferRef = useRef<TimelineRow[]>([]);
  const seqRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const scheduleFlush = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (bufferRef.current.length === 0) return;
      setRows((prev) => {
        const next = [...prev, ...bufferRef.current];
        bufferRef.current = [];
        // Retain only last 200 rows for memory (D-125)
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    });
  };

  const push = (event: string, payload: Record<string, unknown> | null) => {
    const agentId = (payload?.agent_id ?? payload?.id ?? '') as string;
    if (currentAgentId && agentId && agentId !== currentAgentId) return;  // D-130 filter
    const seq = ++seqRef.current;
    bufferRef.current.push({
      seq,
      ts: Date.now(),
      event,
      agentId,
      preview: JSON.stringify(payload).slice(0, 80),
    });
    scheduleFlush();
  };

  // 10 parallel subscriptions (D-129)
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.BLADE_AGENT_EVENT,      (p) => push('blade_agent_event', p));
  useTauriEvent<AgentStepStartedPayload>(BLADE_EVENTS.AGENT_STEP_STARTED, (p) => push('agent_step_started', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_RESULT,       (p) => push('agent_step_result', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_RETRYING,     (p) => push('agent_step_retrying', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_TOOL_FALLBACK,(p) => push('agent_step_tool_fallback', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_PROVIDER_FALLBACK,(p) => push('agent_step_provider_fallback', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_PARTIAL,      (p) => push('agent_step_partial', p));
  useTauriEvent<AgentStepCompletedPayload>(BLADE_EVENTS.AGENT_STEP_COMPLETED,(p) => push('agent_step_completed', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_STEP_FAILED,       (p) => push('agent_step_failed', p));
  useTauriEvent<AgentEventPayload>(BLADE_EVENTS.AGENT_EVENT,              (p) => push('agent_event', p));

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  return rows;
}
```

**Rules:**
- Every high-frequency subscriber uses the ref-buffer + rAF-flush pattern.
- `useTauriEvent` is called at top-level hook scope (not inside loops) — React requires stable subscription count.
- Event-to-agent correlation happens client-side via `payload?.agent_id ?? payload?.id` (D-130 loose-shape).
- Buffer retention capped at 200 rows (AgentDetail) or similar bound per surface.

---

## 3. SwarmDAG rendering recipe (Plan 05-04)

Read-only DAG rendered as CSS Grid (topological layer columns) + SVG connection lines. Deterministic layout.

```tsx
// src/features/agents/SwarmDAG.tsx (Plan 05-04)
import { useMemo } from 'react';
import type { Swarm, SwarmStep } from '@/lib/tauri/agents';

interface LayoutNode {
  step: SwarmStep;
  layer: number;     // topological layer = max depth of deps + 1
  row: number;       // index within layer
  x: number;         // column position in pixels
  y: number;         // row position in pixels
}

const LAYER_COL_WIDTH = 220;
const NODE_ROW_HEIGHT = 96;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;

function computeLayout(swarm: Swarm): LayoutNode[] {
  // Topological layer assignment (longest path from root)
  const stepById = new Map(swarm.steps.map((s) => [s.id, s]));
  const layerById = new Map<string, number>();
  const walk = (id: string): number => {
    if (layerById.has(id)) return layerById.get(id)!;
    const step = stepById.get(id);
    if (!step || !step.deps?.length) {
      layerById.set(id, 0);
      return 0;
    }
    const layer = 1 + Math.max(...step.deps.map(walk));
    layerById.set(id, layer);
    return layer;
  };
  swarm.steps.forEach((s) => walk(s.id));
  // Group by layer
  const byLayer = new Map<number, SwarmStep[]>();
  swarm.steps.forEach((s) => {
    const l = layerById.get(s.id)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(s);
  });
  // Emit layout nodes
  const nodes: LayoutNode[] = [];
  byLayer.forEach((stepsInLayer, layer) => {
    stepsInLayer.forEach((step, row) => {
      nodes.push({
        step, layer, row,
        x: layer * LAYER_COL_WIDTH + 20,
        y: row * NODE_ROW_HEIGHT + 20,
      });
    });
  });
  return nodes;
}

export function SwarmDAG({ swarm }: { swarm: Swarm }) {
  const nodes = useMemo(() => computeLayout(swarm), [swarm]);
  const width = Math.max(...nodes.map((n) => n.x + NODE_WIDTH), 400) + 20;
  const height = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT), 200) + 20;
  const nodeById = new Map(nodes.map((n) => [n.step.id, n]));

  return (
    <div className="swarm-dag" style={{ width, height, position: 'relative' }}>
      <svg
        className="swarm-dag-edges"
        width={width} height={height}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        {nodes.flatMap((n) =>
          (n.step.deps ?? []).map((depId) => {
            const from = nodeById.get(depId);
            if (!from) return null;
            // Axis-aligned L-shape from from-right-center to n-left-center (D-124)
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = n.x;
            const y2 = n.y + NODE_HEIGHT / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={`${depId}→${n.step.id}`}
                d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`}
                stroke="var(--line)" strokeWidth={1.5} fill="none"
              />
            );
          }),
        )}
      </svg>
      {nodes.map((n) => (
        <SwarmNode
          key={n.step.id}
          step={n.step}
          style={{ position: 'absolute', left: n.x, top: n.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
        />
      ))}
    </div>
  );
}
```

**Rules:**
- Deterministic layout — `useMemo` on swarm id only; recompute on actual change.
- SVG edges are axis-aligned L-paths (no bezier curves; matches D-124 "legibility over prettiness").
- Node cards use Phase 1 GlassPanel primitive OR rgba bg (D-70 discipline — inside DAG we're under the blur-cap budget already).
- Zoom/pan explicitly deferred (D-124).

---

## 4. KnowledgeGraph deterministic layout (Plan 05-05)

Polar coordinates by deterministic hash of id. No d3-force.

```ts
// src/features/knowledge/graphLayout.ts (Plan 05-05)
export interface GraphNode {
  id: string;
  label: string;
  tag?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  weight?: number;
}
export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
}

// FNV-1a — deterministic, seedless, collision tolerance good enough for layout
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function layoutNodes(nodes: GraphNode[], radius: number, cx: number, cy: number): LaidOutNode[] {
  return nodes.map((n) => {
    const h = hash32(n.id);
    // Map hash to (r, theta) in concentric ring pattern
    // 3 rings — inner 40%, middle 70%, outer 100% of radius
    const ringPicker = h & 3;
    const ringR = radius * (ringPicker === 0 ? 0.4 : ringPicker === 1 ? 0.7 : 1.0);
    const theta = ((h >>> 2) / 0x40000000) * Math.PI * 2;
    return {
      ...n,
      x: cx + Math.cos(theta) * ringR,
      y: cy + Math.sin(theta) * ringR,
    };
  });
}
```

**Rules:**
- Hash → (r, θ): the same node id always lands at the same coordinate — reloads preserve user's mental map.
- Concentric rings (3) prevent all nodes landing on outer circle.
- If `nodes.length > 200`, cluster by `tag` before layout; render clusters as single node + "+N more" expand-on-click.

---

## 5. Cluster index rewrite (Plan 05-02 — ONE-WRITE rule)

Each cluster's index.tsx gets rewritten exactly ONCE in Plan 05-02. After that, wave-2 plans only CREATE sibling per-route files; they NEVER edit the index.

```tsx
// src/features/agents/index.tsx (Plan 05-02 rewrites — final form)
// Phase 5: replaces Phase 1 skeletons with lazy imports of real route components.
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-122

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const AgentDashboard   = lazy(() => import('./AgentDashboard').then((m) => ({ default: m.AgentDashboard })));
const AgentDetail      = lazy(() => import('./AgentDetail').then((m) => ({ default: m.AgentDetail })));
const AgentFactory     = lazy(() => import('./AgentFactory').then((m) => ({ default: m.AgentFactory })));
const AgentTeam        = lazy(() => import('./AgentTeam').then((m) => ({ default: m.AgentTeam })));
const AgentTimeline    = lazy(() => import('./AgentTimeline').then((m) => ({ default: m.AgentTimeline })));
const BackgroundAgents = lazy(() => import('./BackgroundAgents').then((m) => ({ default: m.BackgroundAgents })));
const TaskAgents       = lazy(() => import('./TaskAgents').then((m) => ({ default: m.TaskAgents })));
const SwarmView        = lazy(() => import('./SwarmView').then((m) => ({ default: m.SwarmView })));
const AgentPixelWorld  = lazy(() => import('./AgentPixelWorld').then((m) => ({ default: m.AgentPixelWorld })));

export const routes: RouteDefinition[] = [
  { id: 'agents',            label: 'Agents',            section: 'agents', component: AgentDashboard,   phase: 5, description: 'Running + idle agents' },
  { id: 'agent-detail',      label: 'Agent Detail',      section: 'agents', component: AgentDetail,      phase: 5 },
  { id: 'agent-factory',     label: 'Agent Factory',     section: 'agents', component: AgentFactory,     phase: 5 },
  { id: 'agent-team',        label: 'Agent Team',        section: 'agents', component: AgentTeam,        phase: 5 },
  { id: 'agent-timeline',    label: 'Agent Timeline',    section: 'agents', component: AgentTimeline,    phase: 5 },
  { id: 'background-agents', label: 'Background Agents', section: 'agents', component: BackgroundAgents, phase: 5 },
  { id: 'task-agents',       label: 'Task Agents',       section: 'agents', component: TaskAgents,       phase: 5 },
  { id: 'swarm-view',        label: 'Swarm',             section: 'agents', component: SwarmView,        phase: 5 },
  { id: 'agent-pixel-world', label: 'Pixel World',       section: 'agents', component: AgentPixelWorld,  phase: 5 },
];
```

**Rules:**
- Plan 05-02 is the SINGLE writer of these two index.tsx files.
- Plans 05-03..06 each CREATE a disjoint subset of per-route files; file ownership is exclusive per plan; no concurrent edits.
- Component names match file names verbatim; re-exports are `{ default: m.Name }` form to keep tree-shake-friendly named exports in the per-route files.

---

## 6. Event registry extension (Plan 05-01)

```ts
// src/lib/events/index.ts — Plan 05-01 appends to existing BLADE_EVENTS
// (only NEW additions shown; existing entries untouched)

// ───── Agents step events (7 distinct Rust emit sites) ─────
AGENT_STEP_RETRYING:          'agent_step_retrying',          // executor.rs:177
AGENT_STEP_TOOL_FALLBACK:     'agent_step_tool_fallback',     // executor.rs:243
AGENT_STEP_PROVIDER_FALLBACK: 'agent_step_provider_fallback', // executor.rs:267
AGENT_STEP_PARTIAL:           'agent_step_partial',           // executor.rs:314
AGENT_STEP_COMPLETED:         'agent_step_completed',         // executor.rs:335
AGENT_STEP_FAILED:            'agent_step_failed',            // executor.rs:349
```

```ts
// src/lib/events/payloads.ts — Plan 05-01 appends new interfaces

export interface AgentStepStartedPayload {
  step_id: string;
  agent_id: string;
  tool_name?: string;
  role?: string;
  input_preview?: string;
  [k: string]: unknown;
}

export interface AgentStepCompletedPayload {
  step_id: string;
  agent_id: string;
  duration_ms?: number;
  result_preview?: string;
  [k: string]: unknown;
}

export interface SwarmProgressPayload {
  swarm_id: string;
  completed_steps: number;
  total_steps: number;
  current_step_id?: string;
  status?: 'pending' | 'running' | 'paused' | 'complete' | 'failed';
  [k: string]: unknown;
}

export interface SwarmCreatedPayload {
  swarm_id: string;
  total_steps: number;
  [k: string]: unknown;
}

export interface SwarmCompletedPayload {
  swarm_id: string;
  duration_ms?: number;
  error?: string;
  [k: string]: unknown;
}

export interface AgentOutputPayload {
  id: string;
  output: string;
  [k: string]: unknown;
}
```

**Rules:**
- ALL new payloads retain index signatures (`[k: string]: unknown`) for forward-compat (matches D-38-payload).
- Constants are kebab-case-from-Rust → SNAKE_CASE_FRONTEND in the enum; values are the exact Rust emit string (lowercase snake).
- Payload files must pass `npx tsc --noEmit`.

---

## 7. Playwright spec recipe (Plan 05-07)

Extend the Phase 1..4 `@tauri-apps/test`-based harness. Isolation dev routes mount individual components for deterministic assertion. Pattern copied from `04-07` (VoiceOrbDev.tsx etc.).

```ts
// tests/e2e/agent-detail-timeline.spec.ts (Plan 05-07)
import { test, expect } from '@playwright/test';

test('AgentDetail timeline appends events in real time without refresh', async ({ page }) => {
  await page.goto('http://localhost:1420/#/dev/agent-detail');
  await page.waitForSelector('[data-testid="agent-detail-root"]');

  // Inject synthetic events via __TAURI_EMIT__ hook (Phase 1 established)
  await page.evaluate(() => {
    const emit = (window as any).__TAURI_EMIT__;
    emit('blade_agent_event', { agent_id: 'test-agent-1', status: 'started' });
    emit('agent_step_started', { step_id: 'step-1', agent_id: 'test-agent-1' });
    emit('agent_step_completed', { step_id: 'step-1', agent_id: 'test-agent-1', duration_ms: 120 });
  });

  // Wait a frame for rAF flush
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('[data-testid="timeline-row"]');
    return rows.length >= 3;
  });

  const rows = await page.locator('[data-testid="timeline-row"]').count();
  expect(rows).toBeGreaterThanOrEqual(3);
});
```

**Rules:**
- Dev-only isolation routes under `src/features/dev/` (e.g. `AgentDetailDev.tsx` pre-pins the agent id so the spec doesn't need to spawn a backend agent).
- All specs reuse existing harness — NO new test deps.
- Each spec asserts ONE success criterion.

---

## 8. Verify script recipe (Plan 05-07)

Bash greps for Rust surface presence + dev-only route presence + no-orphan-route. Pattern from Phase 4's verify-content-protect.sh.

```bash
# scripts/verify-phase5-rust-surface.sh (Plan 05-07)
#!/usr/bin/env bash
set -euo pipefail

MISSING=()

check() {
  local pattern="$1"
  if ! grep -q -E "$pattern" src-tauri/src/lib.rs; then
    MISSING+=("$pattern")
  fi
}

# Agents cluster commands
check 'agent_commands::agent_create'
check 'agent_commands::agent_list'
check 'agent_commands::agent_pause'
check 'background_agent::agent_spawn'
check 'swarm_commands::swarm_list'
check 'swarm_commands::swarm_get'
# ... (expand to all 40+ per D-119 inventory)

# Knowledge cluster commands
check 'knowledge_graph::graph_search_nodes'
check 'memory_palace::memory_search'
check 'typed_memory::memory_recall_category'
check 'embeddings::semantic_search'
check 'screen_timeline_commands::timeline_search_cmd'
check 'document_intelligence::doc_search'
check 'db_commands::db_search_knowledge'
# ...

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Phase 5 required Rust commands not found in lib.rs:" >&2
  for m in "${MISSING[@]}"; do echo "  - $m" >&2; done
  exit 1
fi
echo "OK: all Phase 5 Rust commands registered."
```

**Rules:**
- One bash/node verify script per phase regression concern.
- Exit non-zero on missing entries; CI fails fast.
- `npm run verify:all` composes these (Plan 05-07 adds the entries).

---

## 9. usePrefs extension

```ts
// src/hooks/usePrefs.ts (Plan 05-01 or 05-02 — minor edit)
export interface Prefs {
  // ... existing keys
  'agents.filterStatus'?: 'all' | 'running' | 'idle' | 'failed';
  'agents.selectedAgent'?: string;
  'knowledge.lastTab'?: string;
  'knowledge.sidebarCollapsed'?: boolean;
  'screenTimeline.autoLoadLatest'?: boolean;
}
```

Debounce + single blob discipline preserved (D-12).

---

## 10. Common CSS conventions (Plan 05-03..06)

```css
/* src/features/agents/agents.css (Plan 05-02 creates; 05-03..06 extend) */
.agents-surface {
  padding: var(--sp-4);
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: var(--sp-3);
}

.agent-card {
  background: rgba(255, 255, 255, 0.04);   /* D-70 rgba, not backdrop-filter */
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: var(--sp-3);
}

.agent-card[data-status="running"] { border-left: 3px solid var(--status-running); }
.agent-card[data-status="complete"] { border-left: 3px solid var(--status-success); }
.agent-card[data-status="failed"]   { border-left: 3px solid var(--status-error); }
```

**Rules:**
- Only `GlassPanel` primitive uses `backdrop-filter`; every inner card uses `rgba(...)` bg (D-07 + D-70).
- Every status color is a CSS token (`--status-running` etc.) — add to `tokens.css` if missing (Plan 05-02 minor edit).
- No hex colors in component files.

---

*Phase: 05-agents-knowledge*
*Patterns captured: 2026-04-19 — downstream plans MUST follow these or justify in commit messages.*
