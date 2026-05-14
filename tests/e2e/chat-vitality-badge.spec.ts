// tests/e2e/chat-vitality-badge.spec.ts — Phase 59 SC-1 falsifier (TRIO-TESTS test b).
//
// Asserts VitalityBadge renders in the chat header and updates when a
// BLADE_VITALITY_UPDATE event fires (mocked) — the literal Phase 59 REQ-5
// gate (b): "VitalityBadge component renders + updates when presence event
// fires (mock the event)."
//
// Path deviation note: see dev-tools-pane.spec.ts header — Phase 59 REQ asked
// for vitest tests under `src/features/dev-tools/__tests__/`. BLADE's actual
// runner is Playwright e2e; this file lands the same falsifier in the working
// runner. The "presence event" the REQ references is BLADE_VITALITY_UPDATE
// (the band/scalar emitter VitalityBadge subscribes to, vitality_engine.rs).
//
// Flow:
//   1. Mount the chat route (default).
//   2. Assert badge does NOT render until first event lands (silent on fresh
//      installs, per VitalityBadge.tsx contract).
//   3. Emit BLADE_VITALITY_UPDATE with band=Thriving.
//   4. Assert badge mounts with data-band="Thriving".
//   5. Emit BLADE_VITALITY_UPDATE with band=Critical.
//   6. Assert badge data-band transitions to "Critical".
//
// Falsifier: if VitalityBadge ignores the event, if data-band attr regresses,
// or if the badge renders pre-first-event, an assertion fails.
//
// @see src/features/chat/VitalityBadge.tsx (data-testid="vitality-badge")
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

test.describe('Phase 59 TRIO-TESTS (b) — VitalityBadge renders + updates on event', () => {
  test('VitalityBadge stays silent until BLADE_VITALITY_UPDATE fires, then updates data-band', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount chat (the default route — VitalityBadge is mounted in ChatPanel's
    // header). Use the route request handshake to be explicit.
    await handles.emitEvent('blade_route_request', { route_id: 'chat' });

    // Pre-event: badge MUST NOT render (VitalityBadge returns null until first
    // BLADE_VITALITY_UPDATE arrives).
    await expect(page.locator('[data-testid="vitality-badge"]')).toHaveCount(0);

    // Emit first vitality update — band=Thriving.
    await handles.emitEvent('blade_vitality_update', {
      scalar: 0.85,
      band: 'Thriving',
      trend: 0.02,
      top_factor: 'mock-thriving',
    });

    const badge = page.locator('[data-testid="vitality-badge"]');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveAttribute('data-band', 'Thriving');

    // Second update — band transition to Critical. data-band must update.
    await handles.emitEvent('blade_vitality_update', {
      scalar: 0.15,
      band: 'Critical',
      trend: -0.1,
      top_factor: 'mock-critical',
    });

    await expect(badge).toHaveAttribute('data-band', 'Critical', { timeout: 5000 });
  });
});
