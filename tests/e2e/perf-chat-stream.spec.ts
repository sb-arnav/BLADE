// tests/e2e/perf-chat-stream.spec.ts — Phase 9 Plan 09-05 (D-224, POL-05).
//
// Chat render benchmark at 50 tokens/sec. Loose CI target: max rAF frame delta
// < 20ms. Mac-smoke M-42 keeps the tight 16ms target on real hardware + React
// Profiler.
//
// Approach:
//   1. Install the returning-user Tauri shim + expose __BLADE_TEST_EMIT__ so
//      the test dispatches synthetic events (reuses Phase 3 chat-stream pattern).
//   2. Navigate to /#/chat via emit_route_request or NavRail click.
//   3. Install a rAF-delta observer on window that records `performance.now()`
//      between successive frame callbacks.
//   4. Dispatch 50 `chat_token` events at 20ms intervals (50 tok/sec).
//   5. Assert `max(frameDeltas) < 20ms` (loose CI budget; Mac-smoke M-42 owns 16ms).
//
// The frame delta is a good proxy for render work: a blocked main thread from
// a heavy commit stretches the delta between paints. Under healthy rAF batching
// (D-68), commits stay under the frame budget.
//
// @see .planning/phases/09-polish/09-CONTEXT.md §D-224
// @see tests/e2e/chat-stream.spec.ts (Phase 3 rAF-commit-count reference)

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
/** D-224 loose CI budget — metal target is 16ms (Mac-smoke M-42). */
const MAX_FRAME_DELTA_MS = 20;
const TOKEN_COUNT = 50;
const BURST_DURATION_MS = 1000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  startFrameProbe: () => Promise<void>;
  readFrameDeltas: () => Promise<number[]>;
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

    function emit(event: string, payload: unknown): void {
      for (const l of state.listeners.values()) {
        if (l.event !== event) continue;
        try { l.callback({ event, id: l.eventId, payload }); }
        catch (e) { console.error('[test-shim] listener threw', e); }
      }
    }
    (window as unknown as { __BLADE_TEST_EMIT__: typeof emit }).__BLADE_TEST_EMIT__ = emit;

    // rAF delta probe — records ms between successive animation frames while
    // the probe is armed. Arm via __BLADE_FRAME_PROBE_START__; read via
    // __BLADE_FRAME_DELTAS__.
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
        case 'get_config':              return { ...baseConfig };
        case 'get_onboarding_status':   return true;
        case 'send_message_stream':     return null;
        case 'cancel_chat':              return null;
        case 'respond_tool_approval':   return null;
        case 'homeostasis_get':         return { arousal: 0.3, energy_mode: 0.5, exploration: 0.4, trust: 0.6, urgency: 0.2, hunger: 0.3, thirst: 0.3, insulin: 0.4, adrenaline: 0.2, leptin: 0.5, last_updated: Date.now() };
        case 'perception_get_latest':   return null;
        case 'perception_update':       return null;
        default:                         return null;
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

test.describe('Phase 9 POL-05 — Chat stream render budget (D-224)', () => {
  test('max rAF frame delta < 20ms at 50 tok/sec (loose CI; Mac-smoke M-42 enforces 16ms)', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.locator('.navrail button[data-route-id="chat"]').click();
    await expect(page.locator('[data-route-id="chat"]').first()).toBeVisible();

    await handles.emitEvent('blade_message_start', {
      message_id: 'perf-msg-001',
      role: 'assistant',
    });

    // Arm the frame probe AFTER route mount so we measure only the streaming window.
    await handles.startFrameProbe();

    const interval = BURST_DURATION_MS / TOKEN_COUNT;
    const start = Date.now();
    for (let i = 0; i < TOKEN_COUNT; i++) {
      await handles.emitEvent('chat_token', `t${i} `);
      const targetElapsed = (i + 1) * interval;
      const actualElapsed = Date.now() - start;
      const sleep = Math.max(0, targetElapsed - actualElapsed);
      if (sleep > 0) await page.waitForTimeout(sleep);
    }

    await handles.emitEvent('chat_done', null);

    // Give one extra rAF tick to flush the final commit.
    await page.waitForTimeout(50);

    const deltas = await handles.readFrameDeltas();
    // Skip the first delta: it covers the "arm → first tick" window which is
    // not a render, just the time until the next animation frame fires.
    const bodyDeltas = deltas.slice(1);
    const maxDelta = bodyDeltas.length > 0 ? Math.max(...bodyDeltas) : 0;
    // eslint-disable-next-line no-console
    console.log(`[perf-chat-stream] frames=${bodyDeltas.length} max=${maxDelta.toFixed(1)}ms budget=${MAX_FRAME_DELTA_MS}ms`);

    expect(bodyDeltas.length).toBeGreaterThan(0);
    expect(maxDelta).toBeLessThan(MAX_FRAME_DELTA_MS);
  });
});
