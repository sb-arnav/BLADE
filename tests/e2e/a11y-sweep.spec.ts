// tests/e2e/a11y-sweep.spec.ts — Phase 9 Plan 09-06 (POL-04 / POL-07; SC-4 + SC-5).
//
// Two a11y sweep cases:
//
//   1. reduced-motion zeroes --dur-enter (POL-07 / SC-5 partial falsifier).
//      page.emulateMedia({ reducedMotion: 'reduce' }) + assert the
//      prefers-reduced-motion override in motion-a11y.css collapses every
//      duration token to 0.01ms. Direct verification that Plan 09-03 Task 2
//      shipped and is in effect.
//
//   2. ⌘? opens the ShortcutHelp panel (POL-04 / SC-4 direct falsifier).
//      Boot as a returning user (gate='complete') so the palette is mounted,
//      press Meta+Shift+/ (QWERTY ⌘?), assert [data-testid="shortcut-help-grid"]
//      renders, press Escape, assert it unmounts. Verifies Plan 09-05's
//      ShortcutHelp wiring end-to-end.
//
// Reuses the returning-user Tauri shim pattern from Phase 3/4/5/8 specs.
// Zero new dependencies; zero playwright.config.ts changes.
//
// @see src/windows/main/ShortcutHelp.tsx     — data-testid="shortcut-help-grid"
// @see src/styles/motion-a11y.css            — @media (prefers-reduced-motion: reduce)
// @see .planning/phases/09-polish/09-PATTERNS.md §4, §5, §10
// @see .planning/phases/09-polish/09-06-PLAN.md Task 1

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

async function installShim(page: Page): Promise<void> {
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
}

test.describe('Phase 9 a11y sweep — reduced-motion + ⌘? shortcut help (POL-04, POL-07)', () => {
  test('prefers-reduced-motion collapses --dur-enter to 0.01ms (SC-5 partial)', async ({ page }) => {
    await installShim(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        enter: cs.getPropertyValue('--dur-enter').trim(),
        snap:  cs.getPropertyValue('--dur-snap').trim(),
        fast:  cs.getPropertyValue('--dur-fast').trim(),
        base:  cs.getPropertyValue('--dur-base').trim(),
        slow:  cs.getPropertyValue('--dur-slow').trim(),
      };
    });

    // Primary falsifier: the --dur-enter token used by list-entrance class
    // is collapsed to 0.01ms, matching the motion-a11y.css override.
    expect(tokens.enter).toBe('0.01ms');
    // Defensive checks — the override should zero every duration token.
    expect(tokens.snap).toBe('0.01ms');
    expect(tokens.fast).toBe('0.01ms');
    expect(tokens.base).toBe('0.01ms');
    expect(tokens.slow).toBe('0.01ms');
  });

  test('⌘? opens ShortcutHelp panel; Escape closes it (SC-4)', async ({ page }) => {
    await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    const grid = page.getByTestId('shortcut-help-grid');
    await expect(grid).toBeHidden();

    // Meta+Shift+/ is the US-QWERTY encoding of ⌘?. useGlobalShortcuts.ts
    // handles both e.key === '?' and e.key === '/' with shiftKey=true.
    await page.keyboard.press('Meta+Shift+/');
    await expect(grid).toBeVisible({ timeout: 5_000 });

    // Native <dialog> closes on Escape automatically (D-58).
    await page.keyboard.press('Escape');
    await expect(grid).toBeHidden({ timeout: 5_000 });
  });
});
