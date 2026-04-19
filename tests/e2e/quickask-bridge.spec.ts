// tests/e2e/quickask-bridge.spec.ts — Phase 4 SC-1 falsifier (D-93, D-102, D-116).
//
// SC-1: QuickAsk bridge appends the user-turn to main-window chat history and
// auto-navigates main to /chat. The real flow:
//   1. User submits in QuickAsk window → Rust quickask_submit emits
//      `blade_quickask_bridged` to the `main` window.
//   2. <QuickAskBridge> (mounted inside MainShell under ChatProvider) receives
//      the event, calls `injectUserMessage({id, content})` on ChatProvider, and
//      calls `openRoute('chat')` on RouterProvider.
//
// This spec stands up the returning-user shim (so MainShell + QuickAskBridge
// mount), dispatches a synthetic `blade_quickask_bridged`, and asserts:
//   - A bubble with `data-message-id="u-m-1"` (D-116 fallback id derivation
//     path) renders with the query text.
//   - The active route flips to `chat` (the route div has data-route-id="chat").
//
// Harness: same __TAURI_INTERNALS__ + __BLADE_TEST_EMIT__ pattern as
// chat-stream.spec.ts. No new deps.
//
// @see src/features/chat/QuickAskBridge.tsx
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-93, §D-102, §D-116
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1a

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
        case 'get_config':             return { ...baseConfig };
        case 'get_onboarding_status':  return true;
        case 'quickask_submit':        return null;
        case 'emit_route_request':     return null;
        case 'send_message_stream':    return null;
        case 'cancel_chat':            return null;
        case 'homeostasis_get':        return null;
        case 'perception_get_latest':  return null;
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
  };
}

test.describe('Phase 4 SC-1 — QuickAsk bridge', () => {
  test('blade_quickask_bridged injects user turn + navigates to /chat', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // QuickAskBridge is mounted zero-DOM inside MainShell's ChatProvider. On
    // the synthetic emit below it should (a) inject a user turn via
    // injectUserMessage, and (b) call openRoute('chat'). The route div
    // data-route-id="chat" is rendered by RouteSlot.
    const query = 'what time is it?';
    await handles.emitEvent('blade_quickask_bridged', {
      query,
      response: '',
      conversation_id: 'c1',
      mode: 'text',
      timestamp: Date.now(),
      message_id: 'm-1',
      user_message_id: 'u-1',
      source_window: 'quickask',
    });

    // The chat route div is the RouteSlot's wrapper; it may also appear on
    // NavRail buttons as data-route-id — so we specifically scope to the
    // RouteSlot by checking the .main-shell-route descendant.
    await expect(page.locator('.main-shell-route [data-route-id="chat"]')).toBeVisible({ timeout: 5_000 });

    // The injected user turn lands in ChatProvider.messages; MessageBubble
    // renders `data-message-id="u-1"` (D-116 user_message_id path).
    const bubble = page.locator('[data-message-id="u-1"]');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(query);

    // And a "Quick ask bridged" toast should surface — D-116 (QuickAskBridge
    // calls useToast().show). Belt-and-braces assertion on the bridge's full
    // responsibility set.
    await expect(page.getByText(/quick ask bridged/i).first()).toBeVisible();
  });
});
