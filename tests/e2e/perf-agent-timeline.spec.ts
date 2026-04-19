// tests/e2e/perf-agent-timeline.spec.ts — Phase 9 Plan 09-05 (D-225, POL-05).
//
// Agent timeline rAF stability under a 100-event stream at ~30 ev/sec. Loose
// CI target: no single rAF-frame delta > 50ms (i.e. timeline sustains roughly
// 20fps under load). Mac-smoke M-43 enforces the tight 60fps target on metal.
//
// Approach:
//   1. Install the returning-user Tauri shim + expose __BLADE_TEST_EMIT__ +
//      mock agent_get / agent_list to return a synthetic agent.
//   2. Navigate to /#/dev-agent-detail via emit_route_request — the dev route
//      pins agents.selectedAgent so AgentDetail mounts immediately.
//   3. Arm a rAF-delta probe.
//   4. Dispatch 100 blade_agent_event payloads at ~33ms intervals (30 ev/sec).
//   5. Assert max(frameDelta) < 50ms.
//
// If a naive implementation re-renders per-event (not rAF-batched), the
// frame thread stretches past 50ms and this spec falsifies the regression.
//
// @see .planning/phases/09-polish/09-CONTEXT.md §D-225
// @see tests/e2e/agent-detail-timeline.spec.ts (Phase 5 reference — correctness, not perf)

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
const PINNED_AGENT_ID = 'test-agent-1';
/** D-225 loose CI budget — metal target is a true 60fps sustained (Mac-smoke M-43). */
const MAX_FRAME_DELTA_MS = 50;
const EVENT_COUNT = 100;
const BURST_DURATION_MS = EVENT_COUNT * 33; // ~30 ev/sec

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  startFrameProbe: () => Promise<void>;
  readFrameDeltas: () => Promise<number[]>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript((pinnedAgentId: string) => {
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

    const syntheticAgent = {
      id: pinnedAgentId,
      goal: 'Synthetic perf agent',
      status: 'Executing',
      steps: [],
      current_step: 0,
      context: {},
      created_at: Math.floor(Date.now() / 1000) - 30,
      updated_at: Math.floor(Date.now() / 1000),
    };

    function emit(event: string, payload: unknown): void {
      for (const l of state.listeners.values()) {
        if (l.event !== event) continue;
        try { l.callback({ event, id: l.eventId, payload }); }
        catch (e) { console.error('[test-shim] listener threw', e); }
      }
    }
    (window as unknown as { __BLADE_TEST_EMIT__: typeof emit }).__BLADE_TEST_EMIT__ = emit;

    const frameState: { armed: boolean; last: number; deltas: number[] } = {
      armed: false,
      last: 0,
      deltas: [],
    };
    (window as unknown as { __BLADE_FRAME_DELTAS__: number[] }).__BLADE_FRAME_DELTAS__ = frameState.deltas;
    (window as unknown as { __BLADE_FRAME_PROBE_START__: () => void }).__BLADE_FRAME_PROBE_START__ = () => {
      frameState.armed = true;
      frameState.last = performance.now();
      frameState.deltas.length = 0;
    };
    const tick = () => {
      if (frameState.armed) {
        const now = performance.now();
        const dt = now - frameState.last;
        frameState.deltas.push(dt);
        frameState.last = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
      if (cmd === 'plugin:event|listen') {
        const a = (args ?? {}) as { event?: string; handler?: number };
        const handlerId = typeof a.handler === 'number' ? a.handler : -1;
        const cb = state.callbacks.get(handlerId);
        if (!cb || typeof a.event !== 'string') {
          throw new Error(`plugin:event|listen: missing callback or event`);
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
        case 'get_config':             return { ...baseConfig };
        case 'get_onboarding_status':  return true;
        case 'agent_get':              return syntheticAgent;
        case 'agent_list':             return [syntheticAgent];
        case 'agent_pause':            return null;
        case 'agent_resume':           return null;
        case 'agent_cancel':           return null;
        case 'emit_route_request':     return null;
        default:                        return null;
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
  }, PINNED_AGENT_ID);

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
    startFrameProbe: () =>
      page.evaluate(() => {
        const w = window as unknown as { __BLADE_FRAME_PROBE_START__?: () => void };
        w.__BLADE_FRAME_PROBE_START__?.();
      }),
    readFrameDeltas: () =>
      page.evaluate(() => {
        const w = window as unknown as { __BLADE_FRAME_DELTAS__?: number[] };
        return [...(w.__BLADE_FRAME_DELTAS__ ?? [])];
      }),
  };
}

test.describe('Phase 9 POL-05 — Agent timeline rAF stability (D-225)', () => {
  test('max rAF frame delta < 50ms during 100-event burst (loose CI; Mac-smoke M-43 owns tight 60fps)', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-agent-detail isolation route so AgentDetail renders with
    // a pinned synthetic agent (no UI interactions required).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-agent-detail' });
    await expect(page.locator('[data-testid="agent-detail-root"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="agent-detail-summary"]')).toBeVisible({
      timeout: 5000,
    });

    // Arm the probe AFTER the route is mounted so boot work doesn't pollute the stats.
    await handles.startFrameProbe();

    const interval = BURST_DURATION_MS / EVENT_COUNT;
    const start = Date.now();
    for (let i = 0; i < EVENT_COUNT; i++) {
      await handles.emitEvent('blade_agent_event', {
        agent_id: PINNED_AGENT_ID,
        status: 'running',
        step_id: `step-${i}`,
        description: `event ${i}`,
      });
      const targetElapsed = (i + 1) * interval;
      const actualElapsed = Date.now() - start;
      const sleep = Math.max(0, targetElapsed - actualElapsed);
      if (sleep > 0) await page.waitForTimeout(sleep);
    }

    // Give one extra rAF tick to flush any trailing commit.
    await page.waitForTimeout(50);

    const deltas = await handles.readFrameDeltas();
    // Skip the first delta (arm → first tick) to avoid a false floor.
    const bodyDeltas = deltas.slice(1);
    const maxDelta = bodyDeltas.length > 0 ? Math.max(...bodyDeltas) : 0;
    // eslint-disable-next-line no-console
    console.log(`[perf-agent-timeline] frames=${bodyDeltas.length} max=${maxDelta.toFixed(1)}ms budget=${MAX_FRAME_DELTA_MS}ms`);

    expect(bodyDeltas.length).toBeGreaterThan(0);
    expect(maxDelta).toBeLessThan(MAX_FRAME_DELTA_MS);
  });
});
