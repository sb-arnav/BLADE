// tests/e2e/ghost-overlay-headline.spec.ts — Phase 4 SC-3 / D-10 falsifier.
//
// D-10 (locked Phase 1): Ghost suggestion card renders
//   - headline ≤ 6 words
//   - 1–2 bullet points
//   - ≤ 60ch per line (CSS-enforced via max-width: 60ch on ghost-headline + bullets)
//
// This spec drives the `/dev-ghost` isolation route, pre-acks the Linux
// content-protection warning (so the Dialog doesn't block on Linux CI), and
// emits a synthetic `ghost_suggestion_ready_to_speak` with a long response.
// Asserts that clipHeadline's output lands in the DOM as:
//   - .ghost-headline      (text whose word-count is 1..6)
//   - .ghost-bullets > li  (1 or 2 list items)
//
// @see src/features/ghost/clipHeadline.ts
// @see src/features/ghost/GhostOverlayWindow.tsx
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-10
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-109, §D-110

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  // Pre-ack the Linux warning so GhostOverlayWindow renders the idle pill /
  // card directly on Linux CI. The dialog-gate check (isLinux &&
  // !prefs['ghost.linuxWarningAcknowledged']) is lazy-evaluated on first
  // render via usePrefs's lazy initialiser, so we seed localStorage BEFORE
  // the main bundle loads.
  await page.addInitScript(() => {
    try {
      const blob = { 'ghost.linuxWarningAcknowledged': true };
      localStorage.setItem('blade_prefs_v1', JSON.stringify(blob));
    } catch {
      /* private mode — test will fail on Linux, which is the desired signal */
    }
  });

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
  };
}

test.describe('Phase 4 SC-3 — Ghost overlay D-10 headline constraints', () => {
  test('long response clips to ≤6-word headline + 1–2 bullets', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-ghost isolation route via blade_route_request (paletteHidden).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-ghost' });
    await expect(page.locator('.main-shell-route [data-route-id="dev-ghost"]')).toBeVisible();

    // Idle pill is the default render when no suggestion has arrived.
    await expect(page.locator('.ghost-idle')).toBeVisible();

    // Emit a long suggestion — clipHeadline should collapse it to ≤6 words +
    // up to 2 sentence-bullets.
    await handles.emitEvent('ghost_suggestion_ready_to_speak', {
      response:
        'Remind them about the budget review tomorrow. It is time to present the Q2 numbers. Key risks are supply chain delays.',
      trigger: 'user mentioned budget',
      speaker: 'Alice',
      confidence: 0.92,
      platform: 'zoom',
      timestamp_ms: Date.now(),
    });

    const headline = page.locator('.ghost-headline');
    await expect(headline).toBeVisible({ timeout: 5_000 });
    const headlineText = (await headline.textContent())?.trim() ?? '';
    const words = headlineText.split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThan(0);
    expect(words.length).toBeLessThanOrEqual(6);

    const bulletCount = await page.locator('.ghost-bullets li').count();
    expect(bulletCount).toBeGreaterThanOrEqual(1);
    expect(bulletCount).toBeLessThanOrEqual(2);
  });
});
