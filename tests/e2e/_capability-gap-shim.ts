// tests/e2e/_capability-gap-shim.ts — Phase 11 Plan 11-05 shared Tauri shim.
//
// Installs a reflective mock for the core invoke surface the main window
// needs at boot (get_config, get_onboarding_status, get_all_provider_keys,
// ...) with a configurable provider_capabilities map so capability-gap
// specs can simulate "vision missing" / "audio missing" / etc scenarios.
//
// All 8 capability-gap specs use this helper via installCapabilityGapShim().
// Navigation uses window.__BLADE_TEST_OPEN_ROUTE (Plan 11-05 Task 1 hatch,
// activated by the `?e2e=1` query param on page.goto('/?e2e=1')).

import type { Page } from '@playwright/test';

interface ProviderCapabilityRecord {
  provider: string;
  model: string;
  context_window: number;
  vision: boolean;
  audio: boolean;
  tool_calling: boolean;
  long_context: boolean;
  last_probed: string;
  probe_status: string;
}

export interface CapabilityGapShimOptions {
  /** Optional map of provider/model → capability record. Default: empty
   *  (triggers CapabilityGap for every capability). */
  providerCapabilities?: Record<string, ProviderCapabilityRecord>;
  /** Active provider/model override. Default: 'anthropic' / 'claude-sonnet-4-20250514'. */
  provider?: string;
  model?: string;
}

/**
 * Install the main-window Tauri shim the capability-gap specs share.
 *
 * MUST be called BEFORE page.goto() — uses page.addInitScript so the mock
 * is in place before React boots.
 */
export async function installCapabilityGapShim(
  page: Page,
  opts: CapabilityGapShimOptions = {},
): Promise<void> {
  const providerCapabilities = opts.providerCapabilities ?? {};
  const provider = opts.provider ?? 'anthropic';
  const model = opts.model ?? 'claude-sonnet-4-20250514';

  await page.addInitScript(
    ({
      providerCapabilitiesArg,
      providerArg,
      modelArg,
    }: {
      providerCapabilitiesArg: Record<string, ProviderCapabilityRecord>;
      providerArg: string;
      modelArg: string;
    }) => {
      type AnyFn = (...args: unknown[]) => unknown;
      interface Listener {
        eventId: number;
        event: string;
        callback: AnyFn;
      }

      const state = {
        nextCallbackId: 1,
        nextEventId: 1,
        callbacks: new Map<number, AnyFn>(),
        listeners: new Map<number, Listener>(),
      };

      (window as unknown as { __TAURI_INVOKE_CALLS__: unknown[] }).__TAURI_INVOKE_CALLS__ = [];

      const baseConfig = {
        provider: providerArg,
        model: modelArg,
        onboarded: true,
        persona_onboarding_complete: true,
        last_deep_scan: Math.floor(Date.now() / 1000),
        god_mode_tier: 'normal',
        voice_mode: 'off',
        tts_voice: 'system',
        wake_word_enabled: false,
        provider_capabilities: providerCapabilitiesArg,
      };

      async function handleInvoke(
        cmd: string,
        args: Record<string, unknown> | undefined,
      ): Promise<unknown> {
        if (!cmd.startsWith('plugin:event|')) {
          (window as unknown as { __TAURI_INVOKE_CALLS__: unknown[] }).__TAURI_INVOKE_CALLS__.push({ cmd, args });
        }
        if (cmd === 'plugin:event|listen') {
          const a = (args ?? {}) as { event?: string; handler?: number };
          const handlerId = typeof a.handler === 'number' ? a.handler : -1;
          const cb = state.callbacks.get(handlerId);
          if (!cb || typeof a.event !== 'string') {
            throw new Error('plugin:event|listen: missing callback or event');
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
            return true;
          case 'get_all_provider_keys':
            return { providers: [], active_provider: '' };
          default:
            // Return null for every other command — surfaces render either
            // their empty-state or their "loading/error" paths gracefully.
            // Specific specs can override by installing an additional shim.
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
    },
    {
      providerCapabilitiesArg: providerCapabilities,
      providerArg: provider,
      modelArg: model,
    },
  );
}

/** Convenience builder: minimal record where every boolean is false. */
export function incapableRecord(
  provider: string,
  model: string,
): ProviderCapabilityRecord {
  return {
    provider,
    model,
    context_window: 8192,
    vision: false,
    audio: false,
    tool_calling: false,
    long_context: false,
    last_probed: new Date().toISOString(),
    probe_status: 'Active',
  };
}
