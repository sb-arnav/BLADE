// tests/e2e/shortcut-fallback.spec.ts — Phase 4 SC-5 falsifier (D-94).
//
// SC-5: `shortcut_registration_failed` events route through BackendToastBridge
// to distinct toast variants based on payload `severity`:
//   - severity === 'warning'        → warn toast "Shortcut fell back"
//   - severity === 'error' | undef  → error toast "Shortcut registration failed"
//                                     with the full `attempted[]` list in body
//
// This spec boots as a returning user (MainShell + BackendToastBridge mount),
// emits the warning flavour first, asserts the fallback copy, then emits the
// fatal flavour and asserts the "could not register any of" copy appears as a
// separate toast.
//
// @see src/lib/context/BackendToastBridge.tsx (severity branch — lines 65-85)
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-94

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
        case 'get_config':            return { ...baseConfig };
        case 'get_onboarding_status': return true;
        default:                      return null;
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

test.describe('Phase 4 SC-5 — shortcut fallback toast severity', () => {
  test('warning + error payloads route to distinct toast variants', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // ── Warning path: configured shortcut fell back to an alternative. ─────
    await handles.emitEvent('shortcut_registration_failed', {
      shortcut: 'Ctrl+Space',
      name: 'Quick Ask',
      error: 'Ctrl+Space in use; fell back to Alt+Space',
      attempted: ['Ctrl+Space'],
      fallback_used: 'Alt+Space',
      severity: 'warning',
    });

    const warnToast = page.locator('.toast[data-toast-type="warn"]');
    await expect(warnToast).toBeVisible({ timeout: 5_000 });
    await expect(warnToast).toContainText(/shortcut fell back/i);
    await expect(warnToast).toContainText(/alt\+space/i);

    // ── Error path: every candidate failed; full attempted list in body. ───
    await handles.emitEvent('shortcut_registration_failed', {
      shortcut: 'Ctrl+Space',
      name: 'Quick Ask',
      error: 'All shortcut candidates failed',
      attempted: ['Ctrl+Space', 'Alt+Space', 'Ctrl+Shift+Space'],
      severity: 'error',
    });

    const errToast = page.locator('.toast[data-toast-type="error"]');
    await expect(errToast).toBeVisible({ timeout: 5_000 });
    await expect(errToast).toContainText(/could not register any of/i);
    await expect(errToast).toContainText(/ctrl\+shift\+space/i);
  });
});
