// src/lib/tauri/_base.ts
//
// Typed Tauri invoke base. The ONLY permitted invoke surface in the codebase
// (D-13, D-34 — enforced by eslint-rules/no-raw-tauri.js).
//
// D-38 REVISED (post-Mac-smoke discovery 2026-04-19): Tauri 2's
// `#[tauri::command]` macro expects arg keys in camelCase on the JS side and
// auto-converts to snake_case for Rust. Wrappers authored pre-Mac-smoke pass
// args in snake_case ("arg-key-casing verbatim" per original D-38 read) —
// which Tauri rejects with "missing required key <camelCased>".
//
// Rather than rewrite every wrapper site, we normalise outgoing arg keys here.
// Wrappers may still declare either casing; this helper converts snake_case
// keys to camelCase before calling `tauriInvoke`. Rust's receive side is
// unchanged (it always deserialises via the camelCase alias Tauri generates).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36, D-37, D-38
// @see .planning/research/PITFALLS.md §P-04 (arg-key casing drift)

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type TauriErrorKind = 'not_found' | 'bad_args' | 'rust_error' | 'unknown';

export class TauriError extends Error {
  constructor(
    public command: string,
    public kind: TauriErrorKind,
    public rustMessage: string,
  ) {
    super(`[${command}] ${kind}: ${rustMessage}`);
    this.name = 'TauriError';
  }
}

function classify(raw: string): TauriErrorKind {
  const msg = raw.toLowerCase();
  if (msg.includes('not found') || msg.includes('missing')) return 'not_found';
  if (msg.includes('invalid') || msg.includes('bad arg') || msg.includes('expected')) return 'bad_args';
  if (msg.includes('rust') || msg.includes('panic')) return 'rust_error';
  return 'unknown';
}

/**
 * Converts outgoing arg keys to camelCase so Tauri 2's command deserialiser
 * finds them. `api_key` becomes `apiKey`; `baseUrl` stays `baseUrl`; nested
 * object values pass through untouched (Tauri handles struct field casing
 * via the serde derive on the Rust side).
 */
function toCamelArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const ck = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[ck] = v;
  }
  return out;
}

/**
 * Only permitted invoke surface (D-13, D-34 enforced by eslint-rules/no-raw-tauri.js).
 *
 * @example
 *   // @see src-tauri/src/commands.rs `get_onboarding_status() -> bool`
 *   const done = await invokeTyped<boolean>('get_onboarding_status');
 *
 * @example
 *   // @see src-tauri/src/config.rs `store_provider_key(provider: String, api_key: String)`
 *   // Either casing works (helper normalises to camelCase for Tauri):
 *   await invokeTyped('store_provider_key', { provider: 'anthropic', api_key: 'sk-...' });
 *   await invokeTyped('store_provider_key', { provider: 'anthropic', apiKey: 'sk-...' });
 */
export async function invokeTyped<
  TReturn,
  TArgs extends Record<string, unknown> = Record<string, never>
>(command: string, args?: TArgs): Promise<TReturn> {
  try {
    const payload = args ? toCamelArgs(args as Record<string, unknown>) : undefined;
    return await tauriInvoke<TReturn>(command, payload);
  } catch (e) {
    const raw = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
    throw new TauriError(command, classify(raw), raw);
  }
}
