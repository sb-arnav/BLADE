// tests/e2e/hud-bar-render.spec.ts — Phase 4 SC-4 falsifier (D-113, D-114).
//
// SC-4: HUD bar renders 5 chips (time, app, god-mode, hormone, meeting) from
// the 3 Rust events (hud_data_updated, godmode_update, hormone_update) and
// right-click opens a 4-item context menu.
//
// This spec drives /dev-hud, mocks `get_primary_safe_area_insets` to return
// zeros (non-mac branch), emits the 3 data events, and asserts:
//   - .hud-time contains the time string
//   - .hud-app contains the active app
//   - .hud-god contains the god-mode tier
//   - the hormone chip renders (dominant of the 5 surfaced hormones)
//   - .hud-meet renders the meeting line
// Then right-clicks .hud-bar and asserts .hud-menu is visible.
//
// @see src/features/hud/HudWindow.tsx
// @see src/features/hud/HudMenu.tsx
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-113, §D-114, §D-115

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
        case 'get_config':                       return { ...baseConfig };
        case 'get_onboarding_status':            return true;
        case 'get_primary_safe_area_insets':     return { top: 0, bottom: 0, left: 0, right: 0 };
        case 'toggle_window':                    return null;
        case 'overlay_hide_hud':                 return null;
        case 'emit_route_request':               return null;
        default:                                 return null;
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

test.describe('Phase 4 SC-4 — HUD bar render + right-click menu', () => {
  test('5 chips render from events; right-click pops menu', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount /dev-hud via route_request (paletteHidden dev route).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-hud' });
    await expect(page.locator('.main-shell-route [data-route-id="dev-hud"]')).toBeVisible();

    // HUD is always visible (.hud-bar is position: fixed top:0). It renders
    // placeholder values (--:--, —, GM · off) until events arrive.
    await expect(page.locator('.hud-bar')).toBeVisible();

    // hud_data_updated — populates time, app, god-mode tier, meeting chip.
    await handles.emitEvent('hud_data_updated', {
      time: '14:32',
      active_app: 'Figma',
      god_mode_status: 'normal',
      unread_count: 0,
      next_meeting_secs: 600,
      next_meeting_name: 'Standup',
      meeting_active: false,
      meeting_name: null,
      speaker_name: null,
      hive_organs_active: 0,
      hive_pending_decisions: 0,
      hive_status_line: '',
    });

    // hormone_update — dominant of {arousal, exploration, urgency, trust,
    // adrenaline} is urgency=0.8 in this payload.
    await handles.emitEvent('hormone_update', {
      arousal: 0.6,
      energy_mode: 0.5,
      exploration: 0.3,
      trust: 0.7,
      urgency: 0.8,
      hunger: 0.4,
      thirst: 0.5,
      insulin: 0.5,
      adrenaline: 0.2,
      leptin: 0.5,
    });

    // Five chip assertions (SC-4 core).
    await expect(page.locator('.hud-time')).toContainText('14:32');
    await expect(page.locator('.hud-app')).toContainText('Figma');
    await expect(page.locator('.hud-god')).toContainText(/normal/i);
    // HormoneChip uses `.hormone-chip` class; dominant variant carries
    // `.is-dominant`. Phase 3 dashboard harness uses the same selector shape.
    await expect(page.locator('.hud-bar .hormone-chip')).toBeVisible();
    await expect(page.locator('.hud-meet')).toContainText(/standup/i);

    // Right-click the bar; menu should pop at cursor.
    await page.locator('.hud-bar').click({ button: 'right' });
    const menu = page.locator('.hud-menu');
    await expect(menu).toBeVisible();
    // 4 items per D-114.
    await expect(menu.locator('button[role="menuitem"]')).toHaveCount(4);
    await expect(menu.getByRole('menuitem', { name: /open blade/i })).toBeVisible();
  });
});
