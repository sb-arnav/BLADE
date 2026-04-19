// tests/e2e/dev-tools-terminal.spec.ts — Phase 7 SC-1 falsifier (DEV-01).
//
// Asserts Terminal renders a scrollback + echoes run_shell output — the
// ROADMAP Phase 7 SC-1 literal gate: "Terminal routes bash through
// native_tools.rs and returns output." Validates:
//   - Plan 07-03's Terminal.tsx scrollback + submit handler.
//   - Plan 07-02's runShell wrapper (→ run_shell @ native_tools.rs:2988).
//
// Flow:
//   1. Mount /dev-terminal (Plan 07-07 Task 1 passthrough).
//   2. Shim returns a canned run_shell combined-stdout string.
//   3. Assert terminal-root mounts + input submit pushes a cmd row into
//      the scrollback + stdout row contains the mocked output text.
//
// Falsifier: if Terminal drops its input, if run_shell is bypassed, or
// if scrollback stops rendering command echo rows, one assertion fails.
//
// @see src/features/dev-tools/Terminal.tsx (data-testid="terminal-root")
// @see src/features/dev/TerminalDev.tsx
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 2

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

    // Rust run_shell returns a String (combined stdout+stderr) per Plan 07-02
    // wrapper JSDoc note. Terminal.tsx treats non-empty text as a 'stdout' line.
    const mockShellOutput = 'mock-output\nmock-line-2\n';

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
        case 'get_config':          return { ...baseConfig };
        case 'get_onboarding_status': return true;
        case 'run_shell':           return mockShellOutput;
        case 'run_code_block':      return mockShellOutput;
        case 'ask_ai':              return 'Mock AI answer';
        case 'emit_route_request':  return null;
        default:                    return null;
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

test.describe('Phase 7 SC-1 — Terminal renders scrollback + echoes run_shell output (DEV-01)', () => {
  test('Terminal mounts + input submit echoes mock run_shell output', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-terminal isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-terminal' });
    await expect(page.locator('[data-testid="terminal-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Submit a command — pushes a 'cmd' line, awaits run_shell, pushes
    // a 'stdout' line with the mocked output.
    await page.locator('[data-testid="terminal-input"]').fill('echo mock');
    await page.keyboard.press('Enter');

    await expect.poll(
      async () => await page.locator('[data-testid="terminal-line-cmd"]').count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(1);

    // SC-1 explicit falsifier: stdout row rendered with mocked output text.
    await expect(page.locator('[data-testid="terminal-scrollback"]')).toContainText('mock-output', {
      timeout: 5000,
    });
  });
});
