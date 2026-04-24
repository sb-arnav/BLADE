// tests/e2e/phase15/dashboard-hero-signals.spec.ts — Plan 15-04 (DENSITY-07 + DENSITY-03)
//
// Asserts the RightNowHero carries ≥ 3 live signals from the union of
// scan profile (deepScanResults), ecosystem tentacles
// (ecosystemListTentacles), and perception state (perceptionGetLatest) —
// each with a data-signal attribute for falsifiability.
//
// Also asserts:
//   - DENSITY-03 content-over-imagery: .dash-hero background alpha ≥ 0.04
//     (tokenized via var(--g-fill) in dashboard.css)
//   - 15-03 copy rule: no bare "No data" text rendered on dashboard route
//   - No horizontal overflow at the default 1280 viewport width
//
// Uses the same Tauri invoke shim pattern as
// tests/e2e/dashboard-paint.spec.ts — synthetic perception + hormones +
// empty tentacle/scan responses so cold-install conditions are the
// baseline (scan never run → 0 repos, no tentacles enabled → 0 active).
// If the hero renders ≥ 3 signal chips under those cold-install
// conditions, DENSITY-07 holds.
//
// @see src/features/dashboard/RightNowHero.tsx (data-signal chip producer)
// @see src/features/dashboard/dashboard.css (DENSITY-03 glass tier rule)

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

    // Minimal PerceptionState matching src/types/perception.ts shape used by
    // RightNowHero. user_state 'focused' exercises the state-focused chip.
    const syntheticPerception = {
      active_app: 'Test App',
      active_title: 'phase15 spec harness',
      user_state: 'focused',
      ram_used_gb: 4.2,
      disk_free_gb: 120.0,
      top_cpu_process: 'node',
      visible_errors: [] as string[],
    };

    const syntheticHormones = {
      arousal: 0.3,
      energy_mode: 0.5,
      exploration: 0.4,
      trust: 0.6,
      urgency: 0.2,
      hunger: 0.3,
      thirst: 0.3,
      insulin: 0.4,
      adrenaline: 0.2,
      leptin: 0.5,
      last_updated: Date.now(),
    };

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
        case 'get_config':                    return { ...baseConfig };
        case 'get_onboarding_status':         return true;
        case 'perception_get_latest':         return syntheticPerception;
        case 'perception_update':             return syntheticPerception;
        case 'homeostasis_get':               return syntheticHormones;
        // Cold-install baseline: no tentacles enabled, no scan run.
        // The hero must still render all three data-signal chips.
        case 'ecosystem_list_tentacles':      return [] as unknown[];
        case 'deep_scan_results':             return null;
        case 'calendar_get_today':            return [] as unknown[];
        default:                              return null;
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

async function gotoDashboard(page: Page): Promise<void> {
  await installShim(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });
  await expect(page.locator('[data-dashboard-surface]')).toBeVisible({ timeout: 5_000 });
}

/** Parse computed `rgba(...)` / `rgb(...)` background into an alpha value. */
function parseAlpha(bg: string): number {
  // rgba(r, g, b, a) — a is optional and defaults to 1 for rgb().
  const m = bg.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9.]+))?\s*\)$/);
  if (!m) return 1; // non-rgba token (e.g. named color) — treat as opaque
  return m[1] === undefined ? 1 : parseFloat(m[1]);
}

test.describe('Phase 15 Plan 04 — Dashboard hero live signals (DENSITY-07 + DENSITY-03)', () => {
  test('hero renders ≥ 3 data-signal elements from scan + ecosystem + perception', async ({ page }) => {
    await gotoDashboard(page);

    // Wait for the hero to finish its perception fetch → setState commit so
    // all chips have rendered. Use an existing chip as the hydration signal.
    await expect(page.locator('[data-signal="active-app"]').first()).toBeVisible({ timeout: 5_000 });

    const count = await page.locator('[data-signal]').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('hero contains the four labelled signal attributes', async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator('[data-signal="active-app"]').first()).toBeVisible();
    await expect(page.locator('[data-signal="scan-repos"]').first()).toBeVisible();
    await expect(page.locator('[data-signal="tentacles"]').first()).toBeVisible();
    await expect(page.locator('[data-signal="user-state"]').first()).toBeVisible();
  });

  test('hero background alpha ≥ 0.04 (DENSITY-03 content-over-imagery)', async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator('.dash-hero').first()).toBeVisible({ timeout: 5_000 });
    const bg = await page
      .locator('.dash-hero')
      .first()
      .evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    const alpha = parseAlpha(bg);
    // eslint-disable-next-line no-console
    console.log(`[dash-hero bg] ${bg} → alpha ${alpha}`);
    expect(alpha).toBeGreaterThanOrEqual(0.04);
  });

  test('dashboard route never shows bare "No data" text (15-03 copy rule)', async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator('[data-signal="active-app"]').first()).toBeVisible();
    await expect(page.locator('text=No data')).toHaveCount(0);
  });

  test('dashboard has no horizontal overflow at 1280px viewport width', async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator('[data-signal="active-app"]').first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const b = document.body;
      return { scrollWidth: b.scrollWidth, clientWidth: b.clientWidth };
    });
    // scrollWidth may exceed clientWidth by a single device pixel on some
    // renderers — allow a 2px slack, fail if we're shipping a visible
    // horizontal scrollbar.
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);
  });
});
