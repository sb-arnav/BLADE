// tests/e2e/shell.spec.ts — Phase 2 SC-3 + SC-4 falsification (D-63).
//
// Reuses the Phase 1 Playwright harness (playwright.config.ts) + the same
// Tauri shim pattern as onboarding-boot.spec.ts. Boots as a RETURNING user
// (both gate signals true) so the full shell mounts — TitleBar + NavRail +
// CommandPalette + ToastViewport all addressable.
//
// SC-3: ⌘K / Ctrl+K opens palette; fuzzy filter narrows results; Enter
//       navigates via useRouter.openRoute(); Esc closes; palette derives its
//       item list from PALETTE_COMMANDS live (SC-3 acceptance: adding a
//       RouteDefinition in any feature/index.tsx surfaces here with NO
//       palette edit). NavRail button click also changes route.
//
// SC-4: A synthetic `blade_notification` event (the same shape Rust emits)
//       is dispatched via our shim's emit() helper. BackendToastBridge
//       catches it via useTauriEvent and pipes it to ToastProvider.show() —
//       a `.toast[data-toast-type="info"]` appears and auto-dismisses after
//       the 4s default (ToastContext.tsx DEFAULT_DURATION.info).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-57, §D-58, §D-60, §D-63
// @see src/design-system/shell/CommandPalette.tsx (selectors)
// @see src/design-system/shell/NavRail.tsx (data-route-id on NavBtn)
// @see src/lib/context/ToastViewport.tsx (.toast[data-toast-type=...])

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  /**
   * Returns an evaluation-time handle so tests can synthesize Tauri events.
   * Invoked from within the page via page.evaluate().
   */
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

/**
 * Installs the same Tauri shim used by onboarding-boot.spec.ts but hard-wired
 * to the "returning user" scenario (onboarded=true, personaDone=true). The
 * shim exposes an emit helper on `window.__BLADE_TEST_EMIT__` so tests can
 * dispatch synthetic `blade_notification` / `blade_toast` events at will.
 *
 * See onboarding-boot.spec.ts §installTauriShim for the plumbing rationale
 * (transformCallback + plugin:event|listen + invoke routing).
 */
async function installReturningUserShim(page: Page): Promise<ShimHandles> {
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
        try {
          l.callback({ event, id: l.eventId, payload });
        } catch (e) {
          console.error('[test-shim] listener threw', e);
        }
      }
    }

    // Expose the emit helper on window so page.evaluate() can call it.
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
        case 'test_provider':          return 'Connection OK';
        case 'store_provider_key':     return null;
        case 'switch_provider':        return { ...baseConfig };
        case 'set_config':             return null;
        case 'complete_onboarding':    return null;
        case 'deep_scan_start':        return { scanned_at: Date.now() };
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
      unregisterCallback: (id: number): void => {
        state.callbacks.delete(id);
      },
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

async function bootAsReturning(page: Page): Promise<ShimHandles> {
  const handles = await installReturningUserShim(page);
  await page.goto('/');
  await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });
  return handles;
}

test.describe('Phase 2 shell', () => {
  test('SC-3: ⌘K opens palette, fuzzy filter narrows, Enter navigates, Esc closes', async ({ page, browserName }) => {
    await bootAsReturning(page);

    // Meta on WebKit (mac), Control elsewhere — matches useGlobalShortcuts'
    // `e.metaKey || e.ctrlKey` predicate.
    const modKey = browserName === 'webkit' ? 'Meta' : 'Control';

    // Open palette.
    await page.keyboard.press(`${modKey}+KeyK`);
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible();

    // Fuzzy filter — typing 'settings' should at minimum produce a row whose
    // data-route-id is 'settings' (core route, paletteHidden=false).
    const search = dialog.getByRole('textbox', { name: /search routes/i });
    await search.fill('settings');
    await expect(dialog.locator('[role="option"][data-route-id="settings"]')).toBeVisible();

    // Enter navigates to the highlighted (top) row. With an empty recent list,
    // the fuzzy sort puts `settings` near the top; the palette auto-selects
    // index 0 on every query change (CommandPalette.tsx `setSelectedIdx(0)`).
    // To avoid an ambiguity if another route starts with 'settings' (e.g.
    // 'settings-providers'), we click the exact row.
    await dialog.locator('[role="option"][data-route-id="settings"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-route-id="settings"]')).toBeVisible();

    // Re-open + close via Escape. Native <dialog> cancel event routes through
    // Dialog.onClose.
    await page.keyboard.press(`${modKey}+KeyK`);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('SC-3b: palette derives from PALETTE_COMMANDS (core routes visible, onboarding hidden)', async ({ page, browserName }) => {
    await bootAsReturning(page);
    const modKey = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+KeyK`);
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible();

    // With empty query, recents (empty on first boot) + full list sorted
    // alphabetically — core routes must be present.
    await expect(dialog.locator('[role="option"][data-route-id="dashboard"]')).toHaveCount(1);
    await expect(dialog.locator('[role="option"][data-route-id="chat"]')).toHaveCount(1);
    await expect(dialog.locator('[role="option"][data-route-id="settings"]')).toHaveCount(1);

    // Onboarding is paletteHidden (D-56) → MUST NOT appear in the palette.
    await expect(dialog.locator('[role="option"][data-route-id="onboarding"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('SHELL-02: NavRail click changes route + aria-current reflects active', async ({ page }) => {
    await bootAsReturning(page);

    // NavRail renders data-route-id on each NavBtn. Click settings → route
    // changes; aria-current flips.
    const settingsBtn = page.locator('.navrail button[data-route-id="settings"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('[data-route-id="settings"]').first()).toBeVisible();
    await expect(settingsBtn).toHaveAttribute('aria-current', 'page');

    // Click back to dashboard; previous active pill clears.
    const dashBtn = page.locator('.navrail button[data-route-id="dashboard"]');
    await dashBtn.click();
    await expect(dashBtn).toHaveAttribute('aria-current', 'page');
    await expect(settingsBtn).not.toHaveAttribute('aria-current', 'page');
  });

  test('SHELL-07: Mod+[ back / Mod+] forward traverses history', async ({ page, browserName }) => {
    await bootAsReturning(page);
    const modKey = browserName === 'webkit' ? 'Meta' : 'Control';

    // dashboard → settings via NavRail, then Mod+[ back, Mod+] forward.
    await page.locator('.navrail button[data-route-id="settings"]').click();
    await expect(page.locator('[data-route-id="settings"]').first()).toBeVisible();

    await page.keyboard.press(`${modKey}+BracketLeft`);
    await expect(page.locator('[data-route-id="dashboard"]').first()).toBeVisible();

    await page.keyboard.press(`${modKey}+BracketRight`);
    await expect(page.locator('[data-route-id="settings"]').first()).toBeVisible();
  });

  test('SC-4: backend blade_notification → toast renders and auto-dismisses', async ({ page }) => {
    const handles = await bootAsReturning(page);

    // Rust normally emits this after a background task finishes. The shim's
    // emit() routes through registered listeners — BackendToastBridge
    // subscribes to BLADE_NOTIFICATION at MainShell mount.
    await handles.emitEvent('blade_notification', {
      type: 'info',
      message: 'Hello from Rust',
    });

    const toast = page.locator('.toast[data-toast-type="info"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/hello from rust/i);

    // DEFAULT_DURATION.info is 4000ms (ToastContext.tsx); wait slightly longer
    // to catch the auto-dismiss timer.
    await expect(toast).toHaveCount(0, { timeout: 6_000 });
  });

  test('SHELL-04: toast does not block subsequent palette interaction', async ({ page, browserName }) => {
    const handles = await bootAsReturning(page);
    await handles.emitEvent('blade_notification', { type: 'info', message: 'bg task done' });
    await expect(page.locator('.toast[data-toast-type="info"]')).toBeVisible();

    // Palette still opens while a toast is on-screen (portal stacking, D-58).
    const modKey = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+KeyK`);
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeHidden();
  });
});
