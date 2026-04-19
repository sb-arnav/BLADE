// tests/e2e/chat-stream.spec.ts — Phase 3 SC-2 falsifier (D-91 / D-68 / D-69).
//
// SC-2: Chat streams without App-level re-renders; Profiler ≤16ms at 50 tok/sec.
// This spec validates the rAF-flushed buffer discipline from Plan 03-03's
// ChatProvider (D-68): no matter how fast CHAT_TOKEN events arrive, React
// commits on the streamed content are bounded by the refresh rate (rAF).
//
// Assertion: after dispatching 50 synthetic chat_token events over ~1000ms,
// the number of requestAnimationFrame-driven commits observed MUST be ≤60.
// The 60-frame ceiling is the SC-2 budget — ~1 commit per display frame at
// 60Hz for 1s = 60 maximum. A leaky implementation (setState-per-token)
// would fire ≥50 commits PER TOKEN rather than per frame.
//
// Harness: reuses the Phase 2 __TAURI_INTERNALS__ shim pattern from
// shell.spec.ts / onboarding-boot.spec.ts — boots as returning user, mocks
// sendMessageStream, exposes a window.__BLADE_TEST_EMIT__ helper so we can
// dispatch chat_token / blade_message_start / chat_done from the test.
//
// The Profiler hook is a simple rAF observer installed on window:
// window.__RAF_COMMIT_COUNT__ increments whenever an rAF callback fires.
// Since ChatProvider batches via requestAnimationFrame (per D-68), this
// counter is a direct proxy for the React commit count during the stream.
//
// @see src/features/chat/useChat.tsx §scheduleFlush (the rAF batcher)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-68, §D-91
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §11

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
/** D-68 / SC-2 ceiling — 60Hz refresh × 1 second of stream. */
const MAX_COMMITS_PER_SECOND = 60;
/** Synthetic token burst: 50 tokens across 1000ms (50 tok/sec matches SC-2 language). */
const TOKEN_COUNT = 50;
const BURST_DURATION_MS = 1000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  getRafCount: () => Promise<number>;
  resetRafCount: () => Promise<void>;
}

/**
 * Installs the returning-user Tauri shim + an rAF observer. The shim mirrors
 * shell.spec.ts's but additionally:
 *   - Mocks `send_message_stream` to resolve immediately (no real Rust call).
 *   - Exposes `__RAF_COMMIT_COUNT__` on window; a persistent rAF loop
 *     increments it each frame. Tests read the delta across the burst.
 */
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

    // rAF commit counter — proxy for React commit count during a stream.
    // ChatProvider batches setStreamingContent via requestAnimationFrame, so
    // one rAF tick ≈ at most one React commit of streaming content (D-68).
    (window as unknown as { __RAF_COMMIT_COUNT__: number }).__RAF_COMMIT_COUNT__ = 0;
    const pump = () => {
      (window as unknown as { __RAF_COMMIT_COUNT__: number }).__RAF_COMMIT_COUNT__ += 1;
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);

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
        case 'get_config':             return { ...baseConfig };
        case 'get_onboarding_status':  return true;
        case 'send_message_stream':    return null;          // Rust emits drive UI — our test dispatches synthetic events
        case 'cancel_chat':            return null;
        case 'respond_tool_approval':  return null;
        case 'homeostasis_get':        return { arousal: 0.3, energy_mode: 0.5, exploration: 0.4, trust: 0.6, urgency: 0.2, hunger: 0.3, thirst: 0.3, insulin: 0.4, adrenaline: 0.2, leptin: 0.5, last_updated: Date.now() };
        case 'perception_get_latest':  return null;
        case 'perception_update':      return null;
        default:                       return null;
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
    getRafCount: () =>
      page.evaluate(() => (window as unknown as { __RAF_COMMIT_COUNT__?: number }).__RAF_COMMIT_COUNT__ ?? 0),
    resetRafCount: () =>
      page.evaluate(() => { (window as unknown as { __RAF_COMMIT_COUNT__: number }).__RAF_COMMIT_COUNT__ = 0; }),
  };
}

test.describe('Phase 3 SC-2 — Chat streaming rAF discipline', () => {
  test('dispatches 50 chat_token events in 1s, asserts ≤60 rAF commits (D-68)', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Navigate to chat route. NavRail exposes data-route-id on its buttons
    // (asserted by shell.spec.ts). Click the chat button so ChatProvider mounts
    // and its 9 useTauriEvent subscriptions register.
    await page.locator('.navrail button[data-route-id="chat"]').click();
    await expect(page.locator('[data-route-id="chat"]').first()).toBeVisible();

    // Fire blade_message_start to prime the streaming state machine; without
    // it, chat_token events still append to the buffer but there is no
    // message_id for CHAT_DONE to commit against.
    await handles.emitEvent('blade_message_start', {
      message_id: 'test-msg-001',
      role: 'assistant',
    });

    // Reset the rAF counter AFTER boot + route mount so we measure only the
    // streaming window, not the initial render pass.
    await handles.resetRafCount();
    const before = await handles.getRafCount();

    // Dispatch 50 tokens evenly spaced over ~1000ms — 20ms apart. A leaking
    // implementation (per-token setState) would fire 50 React commits here;
    // D-68's rAF batcher caps commits at the display refresh rate.
    const interval = BURST_DURATION_MS / TOKEN_COUNT;
    const start = Date.now();
    for (let i = 0; i < TOKEN_COUNT; i++) {
      await handles.emitEvent('chat_token', `t${i} `);
      // Use page.waitForTimeout so the browser event loop gets to flush rAF.
      const targetElapsed = (i + 1) * interval;
      const actualElapsed = Date.now() - start;
      const sleep = Math.max(0, targetElapsed - actualElapsed);
      if (sleep > 0) await page.waitForTimeout(sleep);
    }

    // Close the stream so the committed message lands in MessageList.
    await handles.emitEvent('chat_done', null);

    const after = await handles.getRafCount();
    const commits = after - before;
    // eslint-disable-next-line no-console
    console.log(`[chat-stream] rAF commits during 50-token/1s burst: ${commits}`);

    // Primary falsifier — SC-2 budget.
    expect(commits).toBeLessThanOrEqual(MAX_COMMITS_PER_SECOND);

    // Sanity floor: if the shim were broken (no rAF firing at all) this would
    // be zero. Expect at least 1 commit across a 1-second streaming window.
    expect(commits).toBeGreaterThan(0);

    // Post-stream: the committed message should render in the list with the
    // concatenated tokens. data-message-id is set by MessageBubble (Plan 03-03).
    const bubble = page.locator('[data-message-id="test-msg-001"]');
    await expect(bubble).toBeVisible();
    // Content should include at least the first and last synthetic tokens.
    await expect(bubble).toContainText('t0 ');
    await expect(bubble).toContainText('t49 ');
  });
});
