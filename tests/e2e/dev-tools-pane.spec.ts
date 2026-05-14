// tests/e2e/dev-tools-pane.spec.ts — Phase 59 SC-1 falsifier (TRIO-TESTS test a).
//
// Asserts the `dev-tools` route mounts the DevToolsPane component and renders
// all 6 sub-tabs (Body Map / Organ Registry / Pixel World / Tentacle Detail /
// Mortality Salience / Ghost Mode) — the literal Phase 59 REQ-5 gate (a):
// "/dev-tools route mounts the DevToolsPane component and renders all 6
// tabs."
//
// Path deviation note: Phase 59 REQ asked for
// `src/features/dev-tools/__tests__/DevToolsPane.test.tsx` using vitest. The
// BLADE codebase has no vitest install — the actual test infrastructure is
// Playwright e2e at tests/e2e/. This file lands the test in the working test
// runner; same falsifier, working `npm run test:e2e` integration.
//
// Flow:
//   1. Mount the `/dev-tools` route via blade_route_request.
//   2. Assert dev-tools-pane-root is visible.
//   3. Assert all 6 sub-tab buttons are mounted by their stable testid.
//
// Falsifier: if DevToolsPane drops a tab, if the tab list regresses, or if
// the route fails to mount, an assertion fails.
//
// @see src/features/dev-tools/DevToolsPane.tsx (data-testid="dev-tools-pane-root")
// @see .planning/milestones/v2.2-REQUIREMENTS.md §Phase 59 TRIO-TESTS

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
        // Default-tab (body-map) lazy-loads BodyMap which calls these on mount;
        // return safe empty shapes so the lazy chunk resolves without errors.
        case 'body_get_summary':      return [];
        case 'body_get_map':          return [];
        case 'body_get_system':       return [];
        case 'homeostasis_get':       return { mortality_salience: 0.1, arousal: 0.3, last_updated: 0 };
        case 'emit_route_request':    return null;
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

const EXPECTED_TABS = [
  'body-map',
  'organ-registry',
  'pixel-world',
  'tentacle-detail',
  'mortality-salience',
  'ghost-mode',
] as const;

test.describe('Phase 59 TRIO-TESTS (a) — /dev-tools route mounts DevToolsPane + 6 tabs', () => {
  test('dev-tools route renders DevToolsPane with all 6 sub-tabs', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount /dev-tools via BLADE_ROUTE_REQUEST — same handoff used by the
    // dev-only isolation routes.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-tools' });

    await expect(page.locator('[data-testid="dev-tools-pane-root"]')).toBeVisible({
      timeout: 8000,
    });

    for (const tab of EXPECTED_TABS) {
      await expect(page.locator(`[data-testid="dev-tools-tab-${tab}"]`)).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
