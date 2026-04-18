// tests/e2e/onboarding-boot.spec.ts — Phase 2 SC-1 + SC-2 falsification (D-63).
//
// Reuses the Phase 1 Playwright harness (playwright.config.ts) — targets the
// Vite dev server at http://localhost:1420 + stubs window.__TAURI_INTERNALS__
// so the full React tree boots without a live Tauri backend.
//
// Scenario A (SC-1): Fresh launch (config.onboarded=false, persona_onboarding_complete=false)
//   → provider picker → Anthropic + fake key → mocked test_provider succeeds
//   → deep scan (mocked: 11 synthetic deep_scan_progress emissions + resolved
//   deep_scan_start) → persona form → Enter BLADE → gate flips to 'complete',
//   dashboard route mounts.
//
// Scenario B (SC-2): Returning user (config.onboarded=true, persona_onboarding_complete=true)
//   → gate skips onboarding, boots directly to default route (dashboard).
//
// This spec targets the React layer only (Vite dev server). The full Tauri
// runtime round-trip is covered by the operator-smoke checkpoint in
// 02-07-PLAN.md §Task 2 — ⌘K palette behaviour + cross-OS traffic lights +
// glass blur fidelity still require a desktop.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-63, §D-48, §D-49
// @see tests/e2e/listener-leak.spec.ts (Phase 1 harness template)

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
const DEEP_SCAN_PHASES = [
  'starting',
  'installed_apps',
  'git_repos',
  'ides',
  'ai_tools',
  'wsl_distros',
  'ssh_keys',
  'package_managers',
  'docker',
  'bookmarks',
  'complete',
] as const;

interface Scenario {
  onboarded: boolean;
  personaDone: boolean;
}

interface ShimOpts extends Scenario {
  /** Phase names emitted by the synthetic deep_scan_start — mirrors deep_scan.rs. */
  phases: string[];
}

/**
 * Installs a Tauri runtime shim on `window.__TAURI_INTERNALS__` before the
 * React bundle evaluates. The shim handles two traffic patterns:
 *
 *   1. Direct invoke()  — every @tauri-apps/api/core call routes to
 *      __TAURI_INTERNALS__.invoke(cmd, args, options). We branch on `cmd`:
 *      - 'get_config', 'get_onboarding_status', 'test_provider',
 *        'store_provider_key', 'switch_provider', 'set_config',
 *        'complete_onboarding', 'deep_scan_start' → scripted responses.
 *      - 'plugin:event|listen' → register a handler by event name so we can
 *        synthesize deep_scan_progress later; return a sequential event id.
 *      - 'plugin:event|unlisten' → drop handler by id.
 *
 *   2. Event plumbing   — @tauri-apps/api/event.listen() calls
 *      transformCallback(handler) to stash the callback, then passes the
 *      resulting id to the plugin:event|listen invoke. We mirror the real
 *      behaviour: transformCallback stores the callback on a map, returns
 *      a numeric id; the listen invoke reads the id from args.handler and
 *      pairs it with the event name.
 */
async function installTauriShim(page: Page, scenario: Scenario): Promise<void> {
  const shimOpts: ShimOpts = { ...scenario, phases: [...DEEP_SCAN_PHASES] };
  await page.addInitScript((opts: ShimOpts) => {
    type AnyFn = (...args: unknown[]) => unknown;
    interface Listener { eventId: number; event: string; callback: AnyFn }

    const state = {
      nextCallbackId: 1,
      nextEventId: 1,
      callbacks: new Map<number, AnyFn>(),
      listeners: new Map<number, Listener>(),
      invokeLog: [] as Array<{ cmd: string; args: unknown }>,
    };

    // Expose for assertions + debugging.
    (window as unknown as { __BLADE_TEST_STATE__: typeof state }).__BLADE_TEST_STATE__ = state;

    const baseConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      onboarded: opts.onboarded,
      persona_onboarding_complete: opts.personaDone,
      last_deep_scan: opts.onboarded ? Math.floor(Date.now() / 1000) : 0,
      god_mode_tier: 'normal',
      voice_mode: 'off',
      tts_voice: 'system',
      wake_word_enabled: false,
    };

    function emit(event: string, payload: unknown): void {
      for (const l of state.listeners.values()) {
        if (l.event !== event) continue;
        // Real Tauri calls handler({ event, id: eventId, payload }).
        try {
          l.callback({ event, id: l.eventId, payload });
        } catch (e) {
          console.error('[test-shim] listener threw', e);
        }
      }
    }

    async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
      state.invokeLog.push({ cmd, args });

      // Event plugin plumbing — must be handled before the user-command switch.
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
        case 'get_config':
          return { ...baseConfig };
        case 'get_onboarding_status':
          return opts.personaDone;
        case 'test_provider':
          return 'Connection OK — claude-sonnet-4';
        case 'store_provider_key':
          return null;
        case 'switch_provider': {
          const a = (args ?? {}) as { provider?: string; model?: string };
          return { ...baseConfig, provider: a.provider ?? baseConfig.provider, model: a.model ?? baseConfig.model };
        }
        case 'set_config':
          // Flip the in-memory config so a subsequent get_config call reflects onboarding.
          baseConfig.onboarded = true;
          return null;
        case 'complete_onboarding':
          baseConfig.persona_onboarding_complete = true;
          return null;
        case 'deep_scan_start':
          // Synthesize 11 scripted deep_scan_progress emissions, spaced onto
          // microtasks so useTauriEvent's listen() promise has a chance to
          // resolve before 'starting' fires. The invoke itself resolves after
          // 'complete' — matching Rust's semantics (deep_scan.rs:1419).
          await new Promise<void>((resolve) => {
            let i = 0;
            const tick = () => {
              const phase = opts.phases[i];
              if (!phase) { resolve(); return; }
              emit('deep_scan_progress', { phase, found: 0 });
              i++;
              // queueMicrotask keeps it fast enough for the 5s timeout but
              // yields to React's useState commit between phases.
              setTimeout(tick, 0);
            };
            setTimeout(tick, 0);
          });
          return { scanned_at: Date.now() };
        default:
          // Unknown commands resolve to null — tolerant, keeps the flow moving
          // if a yet-uncovered emit path lands in a future plan.
          return null;
      }
    }

    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown> | undefined) => handleInvoke(cmd, args),
      transformCallback: (callback: AnyFn, _once?: boolean): number => {
        const id = state.nextCallbackId++;
        state.callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number): void => {
        state.callbacks.delete(id);
      },
      convertFileSrc: (p: string): string => p,
    };
  }, shimOpts);
}

/**
 * Wait for the main shell to boot past ConfigContext's spinner by polling for
 * the `[data-gate-status]` attribute. ConfigProvider shows a fullscreen
 * spinner until get_config resolves; once resolved, MainShell renders with
 * the gate-status attribute on its root.
 */
async function waitForShellBoot(page: Page): Promise<void> {
  await page.waitForSelector('[data-gate-status]', { timeout: BOOT_TIMEOUT_MS });
}

test.describe('Phase 2 onboarding boot gate', () => {
  test('SC-1: fresh launch walks provider → key → scan → persona → shell', async ({ page }) => {
    await installTauriShim(page, { onboarded: false, personaDone: false });
    await page.goto('/');
    await waitForShellBoot(page);

    // Gate: fresh config → needs_provider_key (D-48). TitleBar + OnboardingFlow
    // render; no NavRail, no route slot.
    await expect(page.locator('[data-gate-status="needs_provider_key"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /pick a provider/i })).toBeVisible();

    // Anthropic is default-selected (PROVIDERS[0]). Continue → step 2.
    await page.getByRole('button', { name: /^continue/i }).click();

    // Step 2 — API key entry.
    await expect(page.getByRole('heading', { name: /paste your anthropic key/i })).toBeVisible();
    await page.locator('#onb-api-key').fill('sk-ant-test-0000');
    await page.getByRole('button', { name: /test.*continue/i }).click();

    // Step 3 — Deep scan. The mock emits 11 phases; `complete` forces 100%.
    await expect(page.getByRole('heading', { name: /learning your machine/i })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100', {
      timeout: 5_000,
    });
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 4 — Persona (5 inputs). Enter BLADE enables once all 5 non-empty.
    await expect(page.getByRole('heading', { name: /a few quick questions/i })).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await page.locator(`#persona-${i}`).fill(i === 0 ? 'Arnav, founder' : `answer ${i}`);
    }
    await page.getByRole('button', { name: /enter blade/i }).click();

    // Gate re-evaluates: complete_onboarding → set_config → reload → gate.reEvaluate()
    // flips status to 'complete'. RouteSlot mounts dashboard route.
    await expect(page.locator('[data-gate-status="complete"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-route-id="dashboard"]')).toBeVisible();
  });

  test('SC-2: returning user boots straight to dashboard', async ({ page }) => {
    await installTauriShim(page, { onboarded: true, personaDone: true });
    await page.goto('/');
    await waitForShellBoot(page);

    // Both gate signals true → 'complete' branch. No onboarding heading ever
    // visible; NavRail + RouteSlot + CommandPalette all mounted.
    await expect(page.locator('[data-gate-status="complete"]')).toBeVisible();
    await expect(page.locator('[data-route-id="dashboard"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /pick a provider/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /a few quick questions/i })).toHaveCount(0);
  });
});
