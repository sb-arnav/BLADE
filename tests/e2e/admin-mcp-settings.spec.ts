// tests/e2e/admin-mcp-settings.spec.ts — Phase 7 ADMIN-09 falsifier.
//
// Asserts McpSettings renders server list + add-server button + tool trust
// section. Validates:
//   - Plan 07-06's McpSettings.tsx server list + ToolTrustSection composition.
//   - Plan 07-02's mcpGetServers / mcpServerHealth / mcpServerStatus /
//     getToolOverrides / mcpGetTools wrappers.
//
// Flow:
//   1. Mount /dev-mcp-settings (Plan 07-07 Task 1 passthrough).
//   2. Shim returns 2 canned McpServerInfo rows + tool overrides + health.
//   3. Assert mcp-settings-root mounts + ≥1 mcp-server-row + Add-server
//      button visible + mcp-tool-trust-select present.
//
// Falsifier: if McpSettings stops consuming mcpGetServers, if the Add Server
// Dialog trigger is dropped, or if the ToolTrustSection no longer renders
// select widgets, an assertion fails.
//
// @see src/features/admin/McpSettings.tsx (data-testid="mcp-settings-root")
// @see src/features/dev/McpSettingsDev.tsx
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

    // Matches McpServerInfo (src/lib/tauri/admin.ts → mcp.rs ServerConfig).
    const mockServers = [
      {
        name: 'mock-server-1',
        command: 'mock-cmd',
        args: [],
        env: {},
      },
      {
        name: 'mock-server-2',
        command: 'mock-cmd-2',
        args: [],
        env: {},
      },
    ];

    // Matches McpServerHealth.
    const mockHealth = [
      {
        name: 'mock-server-1',
        connected: true,
        tool_count: 3,
        last_call_time: null,
        error_count: 0,
        reconnect_attempts: 0,
      },
      {
        name: 'mock-server-2',
        connected: false,
        tool_count: 0,
        last_call_time: null,
        error_count: 1,
        reconnect_attempts: 2,
      },
    ];

    // mcp_server_status → Vec<(String, bool)>
    const mockStatus: Array<[string, boolean]> = [
      ['mock-server-1', true],
      ['mock-server-2', false],
    ];

    // Matches McpTool.
    const mockTools = [
      {
        name: 'mock-tool-1',
        qualified_name: 'mock-server-1::mock-tool-1',
        description: 'Mock tool description',
        input_schema: {},
        server_name: 'mock-server-1',
      },
    ];

    // getToolOverrides returns Record<string, ToolRisk>.
    const mockOverrides: Record<string, string> = {
      'mock-server-1::mock-tool-1': 'Auto',
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
        case 'mcp_get_servers':       return mockServers;
        case 'mcp_server_health':     return mockHealth;
        case 'mcp_server_status':     return mockStatus;
        case 'mcp_get_tools':         return mockTools;
        case 'get_tool_overrides':    return mockOverrides;
        case 'classify_mcp_tool':     return 'Auto';
        case 'set_tool_trust':        return null;
        case 'reset_tool_trust':      return null;
        case 'mcp_discover_tools':    return null;
        case 'mcp_add_server':        return null;
        case 'mcp_install_catalog_server': return null;
        case 'mcp_remove_server':     return null;
        case 'mcp_call_tool':         return { content: [], is_error: false };
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

test.describe('Phase 7 ADMIN-09 — McpSettings CRUD + tool trust', () => {
  test('McpSettings mounts with ≥1 server row + Add server button + tool trust select', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await handles.emitEvent('blade_route_request', { route_id: 'dev-mcp-settings' });
    await expect(page.locator('[data-testid="mcp-settings-root"]')).toBeVisible({
      timeout: 5000,
    });

    // ≥1 server row from mocked mcp_get_servers.
    await expect.poll(
      async () => await page.locator('[data-testid="mcp-server-row"]').count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(1);

    // Add server button visible (CRUD entry point).
    await expect(page.locator('[data-testid="mcp-add-server-button"]')).toBeVisible({
      timeout: 3000,
    });

    // Tool trust select present — ToolTrustSection renders at least one select
    // (either from overrides or from tools-without-override fallback list).
    await expect(page.locator('[data-testid="mcp-tool-trust-select"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});
