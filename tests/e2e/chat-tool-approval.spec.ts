// tests/e2e/chat-tool-approval.spec.ts — Phase 3 SC-2 falsifier (D-91 / D-71).
//
// SC-2 tool-call surface: the ToolApprovalDialog (Plan 03-04, D-71) MUST
// enforce a 500ms click-through protection. The Approve + Deny buttons render
// `disabled` for the first 500ms after a `tool_approval_needed` event lands;
// after the timer fires, `unlocked=true` flips them interactive. Clicking
// Approve invokes `respond_tool_approval` with `{approval_id, approved: true}`.
//
// Why 500ms: user protection — prevents a stray Enter/Space keypress (or
// muscle-memory click) from auto-approving a dialog that popped unannounced
// while typing. The 500ms number comes from RECOVERY_LOG §1.4 / ROADMAP SC-2.
//
// What this spec asserts:
//   1. Dialog renders on tool_approval_needed (data-state="open" via native
//      <dialog>.open; we select via role=dialog).
//   2. At t<500ms the Approve button is present but disabled AND carries
//      data-countdown="on".
//   3. At t>500ms the button becomes enabled AND flips to data-countdown="off".
//   4. Clicking Approve invokes respond_tool_approval with the matching
//      approval_id and approved=true.
//
// Rust emits the tool_approval_needed payload with keys
// `approval_id` / `name` / `arguments` (per commands.rs:1687). The TS
// payload interface (payloads.ts) declares `request_id` / `tool_name` /
// `args`. ToolApprovalDialog reads BOTH defensively (Plan 03-04 key-name
// reconciliation). This spec uses the Rust-shaped keys to prove the
// defensive reads work end-to-end.
//
// @see src/features/chat/ToolApprovalDialog.tsx
// @see src-tauri/src/commands.rs:1687 (Rust emit shape)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-71, §D-91
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §12

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface InvokeLogEntry { cmd: string; args: unknown }

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  getInvokeCalls: () => Promise<InvokeLogEntry[]>;
}

/**
 * Installs returning-user Tauri shim; mocks respond_tool_approval to resolve
 * undefined; records every invoke call on __TAURI_INVOKE_CALLS__ so tests can
 * assert post-click IPC traffic.
 */
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

    (window as unknown as { __TAURI_INVOKE_CALLS__: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__ = [];

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
      // Don't log plugin:event|* plumbing — only user commands are assertion-relevant.
      if (!cmd.startsWith('plugin:event|')) {
        (window as unknown as { __TAURI_INVOKE_CALLS__: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__.push({ cmd, args });
      }
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
        case 'get_config':              return { ...baseConfig };
        case 'get_onboarding_status':   return true;
        case 'send_message_stream':     return null;
        case 'cancel_chat':              return null;
        case 'respond_tool_approval':   return null;
        case 'homeostasis_get':          return { arousal: 0.3, energy_mode: 0.5, exploration: 0.4, trust: 0.6, urgency: 0.2, hunger: 0.3, thirst: 0.3, insulin: 0.4, adrenaline: 0.2, leptin: 0.5, last_updated: Date.now() };
        case 'perception_get_latest':   return null;
        case 'perception_update':       return null;
        default:                         return null;
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
          const w = window as unknown as { __BLADE_TEST_EMIT__?: (event: string, payload: unknown) => void };
          w.__BLADE_TEST_EMIT__?.(e as string, p);
        },
        [event, payload] as [string, unknown],
      ),
    getInvokeCalls: () =>
      page.evaluate(
        () => (window as unknown as { __TAURI_INVOKE_CALLS__?: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__ ?? [],
      ),
  };
}

test.describe('Phase 3 SC-2 — Tool approval 500ms delay (D-71)', () => {
  test('dialog disables Approve for 500ms, enables after; click invokes respond_tool_approval', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the ChatProvider by navigating to /chat. Without this, the
    // TOOL_APPROVAL_NEEDED subscriber is not registered and the dialog never renders.
    await page.locator('.navrail button[data-route-id="chat"]').click();
    await expect(page.locator('[data-route-id="chat"]').first()).toBeVisible();

    // Dispatch synthetic tool_approval_needed with the RUST-shaped keys
    // (approval_id / name / arguments) — Plan 03-04's ToolApprovalDialog
    // reads both Rust and TS key shapes via ?? so either works.
    const approvalId = 'req-1';
    await handles.emitEvent('tool_approval_needed', {
      approval_id: approvalId,
      name: 'shell_exec',
      arguments: { cmd: 'ls' },
      context: 'list current dir',
      risk: 'Ask',
    });

    // Dialog is a native <dialog>; Playwright's role=dialog resolver matches.
    const dialog = page.getByRole('dialog', { name: /approve tool:\s*shell_exec/i });
    await expect(dialog).toBeVisible();

    // t≈100ms — buttons must still be disabled + data-countdown="on".
    // We can't reliably sample at an arbitrary clock time under Playwright
    // without racing the 500ms internal timer, so we assert the initial state
    // snapshot (buttons render disabled on first paint because the useEffect
    // sets the setTimeout before the first visual frame; unlocked=false
    // initially).
    const approveBtn = dialog.getByRole('button', { name: /^approve$/i });
    const denyBtn = dialog.getByRole('button', { name: /^deny$/i });
    await expect(approveBtn).toBeDisabled();
    await expect(denyBtn).toBeDisabled();
    await expect(approveBtn).toHaveAttribute('data-countdown', 'on');
    await expect(denyBtn).toHaveAttribute('data-countdown', 'on');

    // After the 500ms timer, both become enabled + data-countdown="off".
    // Playwright's auto-wait retries assertions until the 10s expect timeout,
    // so this naturally waits ~500ms then succeeds.
    await expect(approveBtn).toBeEnabled();
    await expect(approveBtn).toHaveAttribute('data-countdown', 'off');
    await expect(denyBtn).toBeEnabled();
    await expect(denyBtn).toHaveAttribute('data-countdown', 'off');

    // Click Approve — should invoke respond_tool_approval with the matching
    // approval_id and approved=true. The wrapper (src/lib/tauri/chat.ts
    // respondToolApproval) translates camelCase approvalId → snake_case
    // approval_id at the Rust boundary.
    await approveBtn.click();

    // Poll the invoke call log — once the respond_tool_approval entry lands
    // it should carry approval_id=req-1 and approved=true. Retry up to ~3s.
    await expect.poll(
      async () => {
        const calls = await handles.getInvokeCalls();
        return calls.find((c) => c.cmd === 'respond_tool_approval');
      },
      { timeout: 3000, message: 'expected respond_tool_approval to be invoked' },
    ).toBeTruthy();

    const calls = await handles.getInvokeCalls();
    const hit = calls.find((c) => c.cmd === 'respond_tool_approval');
    expect(hit).toBeDefined();
    const args = hit!.args as Record<string, unknown>;
    // Wrapper may send either snake_case approval_id or the camelCase
    // approvalId depending on the invokeTyped transform; tolerate both.
    const receivedApprovalId =
      (args.approval_id as string | undefined) ?? (args.approvalId as string | undefined);
    expect(receivedApprovalId).toBe(approvalId);
    expect(args.approved).toBe(true);

    // After respond → useChat clears toolApprovalRequest → dialog closes.
    await expect(dialog).toBeHidden();
  });
});
