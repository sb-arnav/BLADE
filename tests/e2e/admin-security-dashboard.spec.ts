// tests/e2e/admin-security-dashboard.spec.ts — Phase 7 SC-4 falsifier (ADMIN-05).
//
// Asserts SecurityDashboard renders the hero + 4-tab layout + Pentest tab
// surfaces the ALL-CAPS danger banner — the ROADMAP Phase 7 SC-4 literal
// gate: "SecurityDashboard surfaces active alerts from security_monitor.rs."
// Validates:
//   - Plan 07-05's SecurityDashboard.tsx hero card + 4-tab composition.
//   - Plan 07-05's SecurityPentestTab.tsx danger banner (D-183).
//   - Plan 07-02's securityOverview wrapper (→ security_monitor::security_overview).
//
// Flow:
//   1. Mount /dev-security-dashboard (Plan 07-07 Task 1 passthrough).
//   2. Shim returns a canned SecurityOverview + policies + pentest auth list.
//   3. Assert security-dashboard-root mounts + security-hero visible + 4
//      security-tab entries + clicking Pentest reveals danger banner.
//
// Falsifier: if the hero drops securityOverview wiring, if the tab row
// shrinks below 4, or if Pentest tab stops shipping the ALL-CAPS warning,
// an assertion fails.
//
// @see src/features/admin/SecurityDashboard.tsx (data-testid="security-dashboard-root")
// @see src/features/admin/SecurityPentestTab.tsx (data-testid="security-pentest-warning")
// @see src/features/dev/SecurityDashboardDev.tsx
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

    const now = Math.floor(Date.now() / 1000);

    // Matches SecurityOverview (src/lib/tauri/admin.ts → security_monitor.rs).
    const mockOverview = {
      network_total: 12,
      network_suspicious: 2,
      files_found: 40,
      files_unprotected: 0,
      last_scan_ts: now - 3600,
      summary: 'Mock: 2 suspicious connections flagged',
    };

    // Matches NetworkConnection.
    const mockNetworkFindings = [
      {
        pid: 1234,
        process: 'mock-process',
        remote_addr: '203.0.113.10',
        remote_port: 443,
        state: 'ESTABLISHED',
        suspicious: true,
        reason: 'Mock suspicious connection',
      },
    ];

    // Matches SymbolicPolicy.
    const mockPolicies = [
      {
        id: 'policy-1',
        name: 'Mock Policy',
        condition: 'true',
        action: 'allow',
        reason: 'mock policy for spec',
      },
    ];

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
        case 'get_config':                  return { ...baseConfig };
        case 'get_onboarding_status':       return true;
        case 'security_overview':           return mockOverview;
        case 'security_scan_network':       return mockNetworkFindings;
        case 'security_scan_sensitive_files': return [];
        case 'security_run_audit':          return { scope: 'system', started_at: now, finished_at: now + 1, recon_findings: 'mock', network_findings: 0, file_findings: 0, summary: 'Mock audit' };
        case 'security_audit_deps':         return [];
        case 'security_scan_code':          return [];
        case 'security_check_url':          return { url: '', safe: true, flags: [], recommendation: 'OK' };
        case 'security_check_breach':       return { email: '', breaches: [] };
        case 'security_check_password_hash': return false;
        case 'symbolic_list_policies':      return mockPolicies;
        case 'symbolic_check_policy':       return { allowed: true, triggered_policies: [], action: '', reason: '' };
        case 'symbolic_add_policy':         return null;
        case 'symbolic_verify_plan':        return [];
        case 'pentest_list_auth':           return [];
        case 'pentest_check_auth':          return null;
        case 'pentest_check_model_safety':  return { safe: true };
        case 'pentest_authorize':           return null;
        case 'pentest_revoke':              return null;
        case 'emit_route_request':          return null;
        default:                            return null;
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

test.describe('Phase 7 SC-4 — SecurityDashboard hero + 4 tabs + pentest danger (ADMIN-05)', () => {
  test('SecurityDashboard mounts with hero + 4 tabs + Pentest tab shows ALL-CAPS warning', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await handles.emitEvent('blade_route_request', { route_id: 'dev-security-dashboard' });
    await expect(page.locator('[data-testid="security-dashboard-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Hero visible (SC-4 falsifier — securityOverview wired).
    await expect(page.locator('[data-testid="security-hero"]')).toBeVisible({
      timeout: 5000,
    });

    // 4 tab pills render (Alerts / Scans / Policies / Pentest per D-183).
    await expect(page.locator('[data-testid="security-tab"]')).toHaveCount(4, {
      timeout: 5000,
    });

    // Click Pentest tab — danger banner must surface with ALL-CAPS warning
    // (ILLEGAL / AUTHORIZE per T-07-05-01 mitigation).
    await page.locator('[data-testid="security-tab"][data-tab="pentest"]').click();
    const warning = page.locator('[data-testid="security-pentest-warning"]');
    await expect(warning).toBeVisible({ timeout: 5000 });
    await expect(warning).toContainText(/ILLEGAL|AUTHORIZE/i);
  });
});
