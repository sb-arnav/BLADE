// tests/e2e/swarm-view-render.spec.ts — Phase 5 SC-1 explicit falsifier (AGENT-08).
//
// Asserts SwarmView renders a real DAG from mocked `swarm_*` commands — the
// SC-1 literal gate "SwarmView renders a DAG from swarm_* commands." This
// validates:
//   - Plan 05-04's SwarmDAG.tsx deterministic topological layout (D-124).
//   - SwarmNode.tsx status-driven card surface.
//   - Plan 05-02's swarmList / swarmGet / swarmGetProgress wrappers.
//
// Flow:
//   1. Mount /dev-swarm-view (Plan 05-07 Task 1). Passthrough to SwarmView.
//   2. Shim returns a mocked swarm with 3 tasks + deps (chain a → b → c).
//   3. SwarmView's sidebar populates from swarm_list; user clicks the row.
//   4. SwarmDAG renders — assert ≥3 swarm-node cards and ≥1 SVG path (edge).
//
// Falsifier: if the DAG layout regresses, edges stop rendering, or SwarmDAG
// falls back to a stubbed surface, one of the assertions fails.
//
// @see src/features/agents/SwarmView.tsx (data-testid="swarm-view-root")
// @see src/features/agents/SwarmDAG.tsx (data-testid="swarm-dag-root")
// @see src/features/agents/SwarmNode.tsx (data-testid="swarm-node")
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(() => {
    type AnyFn = (...args: unknown[]) => unknown;
    interface Listener { eventId: number; event: string; callback: AnyFn }

    const state = {
      nextCallbackId: 1,
      nextEventId: 1,
      callbacks: new Map<number, AnyFn>(),
      listeners: new Map<number, Listener>(),
    };

    const baseConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      onboarded: true,
      persona_onboarding_complete: true,
      last_deep_scan: Math.floor(Date.now() / 1000),
      god_mode_tier: 'normal',
      voice_mode: 'off',
      tts_voice: 'system',
      wake_word_enabled: false,
    };

    // Mock Swarm matching src/lib/tauri/agents.ts Swarm interface verbatim.
    // 3-step chain: a → b → c (one edge a→b, one edge a→c, one edge b→c).
    const mockSwarm = {
      id: 'mock-swarm-1',
      goal: 'Playwright mock swarm for SC-1 DAG render',
      status: 'running',
      scratchpad: {},
      scratchpad_entries: [],
      final_result: null,
      tasks: [
        {
          id: 'step-a',
          swarm_id: 'mock-swarm-1',
          title: 'Investigate',
          goal: 'Probe the input',
          task_type: 'research',
          depends_on: [],
          status: 'Completed',
          role: 'Researcher',
          created_at: Math.floor(Date.now() / 1000) - 60,
        },
        {
          id: 'step-b',
          swarm_id: 'mock-swarm-1',
          title: 'Implement',
          goal: 'Write the code',
          task_type: 'code',
          depends_on: ['step-a'],
          status: 'Running',
          role: 'Coder',
          created_at: Math.floor(Date.now() / 1000) - 30,
        },
        {
          id: 'step-c',
          swarm_id: 'mock-swarm-1',
          title: 'Review',
          goal: 'Cross-check output',
          task_type: 'review',
          depends_on: ['step-a', 'step-b'],
          status: 'Pending',
          role: 'Reviewer',
          created_at: Math.floor(Date.now() / 1000) - 10,
        },
      ],
      created_at: Math.floor(Date.now() / 1000) - 60,
      updated_at: Math.floor(Date.now() / 1000),
    };

    const mockProgress = {
      swarm_id: 'mock-swarm-1',
      total: 3,
      completed: 1,
      running: 1,
      failed: 0,
      pending: 1,
      percent: 33,
      estimated_seconds_remaining: null,
    };

    function emit(event: string, payload: unknown): void {
      for (const l of state.listeners.values()) {
        if (l.event !== event) continue;
        try { l.callback({ event, id: l.eventId, payload }); }
        catch (e) { console.error('[test-shim] listener threw', e); }
      }
    }
    (window as unknown as { __BLADE_TEST_EMIT__: typeof emit }).__BLADE_TEST_EMIT__ = emit;

    async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
      if (cmd === 'plugin:event|listen') {
        const a = (args ?? {}) as { event?: string; handler?: number };
        const handlerId = typeof a.handler === 'number' ? a.handler : -1;
        const cb = state.callbacks.get(handlerId);
        if (!cb || typeof a.event !== 'string') {
          throw new Error(`plugin:event|listen: missing callback or event (handler=${handlerId}, event=${String(a.event)})`);
        }
        const eventId = state.nextEventId++;
        state.listeners.set(eventId, { eventId, event: a.event, callback: cb });
        return eventId;
      }
      if (cmd === 'plugin:event|unlisten') {
        const a = (args ?? {}) as { eventId?: number };
        if (typeof a.eventId === 'number') state.listeners.delete(a.eventId);
        return null;
      }
      switch (cmd) {
        case 'get_config':                 return { ...baseConfig };
        case 'get_onboarding_status':      return true;
        case 'swarm_list':                 return [mockSwarm];
        case 'swarm_get':                  return mockSwarm;
        case 'swarm_get_progress':         return mockProgress;
        case 'swarm_pause':                return null;
        case 'swarm_resume':               return null;
        case 'swarm_cancel':               return null;
        case 'emit_route_request':         return null;
        default:                           return null;
      }
    }

    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown> | undefined) => handleInvoke(cmd, args),
      transformCallback: (callback: AnyFn, _once?: boolean): number => {
        const id = state.nextCallbackId++;
        state.callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number): void => { state.callbacks.delete(id); },
      convertFileSrc: (p: string): string => p,
    };
  });

  return {
    emitEvent: (event, payload) =>
      page.evaluate(
        ([e, p]) => {
          const w = window as unknown as {
            __BLADE_TEST_EMIT__?: (event: string, payload: unknown) => void;
          };
          w.__BLADE_TEST_EMIT__?.(e as string, p);
        },
        [event, payload] as [string, unknown],
      ),
  };
}

test.describe('Phase 5 SC-1 explicit — SwarmView renders a DAG from swarm_* (AGENT-08)', () => {
  test('3 swarm-node cards + ≥1 SVG edge render after selecting the mock swarm', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-swarm-view isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-swarm-view' });
    await expect(page.locator('[data-testid="swarm-view-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Sidebar populates from swarm_list — click the single mock row to select.
    const sidebarRow = page.locator('[data-testid="swarm-sidebar-row"]').first();
    await expect(sidebarRow).toBeVisible({ timeout: 5000 });
    await sidebarRow.click();

    // DAG container mounts with data-testid.
    await expect(page.locator('[data-testid="swarm-dag-root"]')).toBeVisible({
      timeout: 5000,
    });

    // 3 node cards render (one per task in the mock swarm).
    await expect(page.locator('[data-testid="swarm-node"]')).toHaveCount(3);

    // ≥1 SVG edge renders (step-a has 2 outgoing deps, step-b has 1) —
    // the DAG emits 3 total <path> edges for this mock. We assert ≥1 so
    // layout-math changes don't falsely trip the spec on edge-count drift.
    const edgeCount = await page.locator('[data-testid="swarm-dag-root"] svg path').count();
    expect(edgeCount).toBeGreaterThanOrEqual(1);
  });
});
