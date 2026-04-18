// src/lib/tauri/_base.ts
//
// Typed Tauri invoke base. The ONLY permitted invoke surface in the codebase
// (D-13, D-34 — enforced in later phases by eslint-rules/no-raw-tauri.js).
//
// Every wrapper in src/lib/tauri/*.ts builds on `invokeTyped`. Every component
// imports from those wrappers, never from `@tauri-apps/api/core` directly.
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
 * Only permitted invoke surface (D-13, D-34 enforced by eslint-rules/no-raw-tauri.js).
 * Arg keys passed verbatim to Rust (snake_case) — no transformation (D-38, P-04 prevention).
 *
 * @example
 *   // @see src-tauri/src/commands.rs:2312 `get_onboarding_status() -> bool`
 *   const done = await invokeTyped<boolean>('get_onboarding_status');
 *
 * @example
 *   // @see src-tauri/src/config.rs:636 `store_provider_key(provider: String, api_key: String)`
 *   await invokeTyped<void, { provider: string; api_key: string }>(
 *     'store_provider_key',
 *     { provider: 'anthropic', api_key: 'sk-...' }
 *   );
 */
export async function invokeTyped<
  TReturn,
  TArgs extends Record<string, unknown> = Record<string, never>
>(command: string, args?: TArgs): Promise<TReturn> {
  try {
    return await tauriInvoke<TReturn>(command, args as Record<string, unknown> | undefined);
  } catch (e) {
    const raw = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
    throw new TauriError(command, classify(raw), raw);
  }
}
