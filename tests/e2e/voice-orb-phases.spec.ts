// tests/e2e/voice-orb-phases.spec.ts — Phase 4 SC-2 falsifier (D-105).
//
// SC-2: Voice Orb transitions idle → listening → thinking → speaking → idle
// in response to the 4 Rust `voice_conversation_*` events. The DOM surface
// is `.orb-overlay[data-phase={phase}]` written by VoiceOrb.tsx (D-103).
//
// Also asserts the self-trigger avoidance: `voice_conversation_ended` sets a
// 2s ignore window for `wake_word_detected`, during which a wake_word emit
// MUST NOT call `start_voice_conversation`. We assert this by counting
// invokes of `start_voice_conversation` via a spy on __TAURI_INTERNALS__.
//
// Harness: returning-user shim mounts MainShell. Navigation to /dev-voice-orb
// happens via NavRail-equivalent ⌘K palette is not used for dev routes
// (paletteHidden). Instead we drive navigation via the RouterProvider's
// route state by simulating a click on an internal anchor — simpler: the
// dev routes are registered in ROUTE_MAP, so we can push the route via the
// palette search query if it were surfaced; since it's hidden, we use the
// direct approach: trigger `blade_route_request` via the shim emit (the
// main window subscribes this and calls openRoute).
//
// @see src/features/voice-orb/VoiceOrb.tsx (data-phase attribute)
// @see src/features/voice-orb/VoiceOrbWindow.tsx (phase state machine)
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-103, §D-105

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  getInvokeCount: (cmd: string) => Promise<number>;
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
      invokeCounts: new Map<string, number>(),
    };
    (window as unknown as { __BLADE_TEST_STATE__: typeof state }).__BLADE_TEST_STATE__ = state;

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
      state.invokeCounts.set(cmd, (state.invokeCounts.get(cmd) ?? 0) + 1);

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
        case 'start_voice_conversation': return null;
        case 'stop_voice_conversation':  return null;
        case 'emit_route_request':     return null;
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
    getInvokeCount: (cmd) =>
      page.evaluate(
        (c) => {
          const s = (window as unknown as {
            __BLADE_TEST_STATE__?: { invokeCounts: Map<string, number> };
          }).__BLADE_TEST_STATE__;
          return s?.invokeCounts.get(c) ?? 0;
        },
        cmd,
      ),
  };
}

/**
 * Navigate to the `/dev-voice-orb` route by emitting `blade_route_request`.
 * The main-window router subscribes this event (Phase 4 Plan 04-05 D-114)
 * and calls openRoute with the requested id. Palette is not available for
 * paletteHidden routes.
 */
async function openDevRoute(page: Page, handles: ShimHandles, routeId: string): Promise<void> {
  await handles.emitEvent('blade_route_request', { route_id: routeId });
}

test.describe('Phase 4 SC-2 — Voice Orb phase transitions', () => {
  test('4 phases + idle reset; wake-word ignored during 2s tail', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev isolation surface.
    await openDevRoute(page, handles, 'dev-voice-orb');
    await expect(page.locator('.main-shell-route [data-route-id="dev-voice-orb"]')).toBeVisible();

    // Idle — initial state from VoiceOrbWindow useState<OrbPhase>('idle').
    await expect(page.locator('.orb-overlay[data-phase="idle"]')).toBeVisible();

    // Listening
    await handles.emitEvent('voice_conversation_listening', { active: true });
    await expect(page.locator('.orb-overlay[data-phase="listening"]')).toBeVisible();

    // Thinking
    await handles.emitEvent('voice_conversation_thinking', { text: 'thinking' });
    await expect(page.locator('.orb-overlay[data-phase="thinking"]')).toBeVisible();

    // Speaking
    await handles.emitEvent('voice_conversation_speaking', { text: 'talking' });
    await expect(page.locator('.orb-overlay[data-phase="speaking"]')).toBeVisible();

    // Ended → idle + 2s wake-word ignore window begins
    const startCountBefore = await handles.getInvokeCount('start_voice_conversation');
    await handles.emitEvent('voice_conversation_ended', { reason: 'stopped' });
    await expect(page.locator('.orb-overlay[data-phase="idle"]')).toBeVisible();

    // Self-trigger avoidance (T-04-03-02): wake_word_detected within the 2s
    // ignore window MUST NOT call start_voice_conversation.
    await handles.emitEvent('wake_word_detected', { confidence: 0.95 });
    // Small settle — invoke is sync but the handler is async. Yield a tick.
    await page.waitForTimeout(50);
    const startCountAfter = await handles.getInvokeCount('start_voice_conversation');
    expect(startCountAfter).toBe(startCountBefore);
  });
});
