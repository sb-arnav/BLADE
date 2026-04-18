// src/hooks/usePrefs.ts — single source of truth for localStorage prefs
// (FOUND-09, D-12, D-42, P-13 prevention).
//
// Invariants:
//   - Single `blade_prefs_v1` localStorage key for the entire frontend.
//   - Read once on mount (useState lazy initializer) — never re-reads.
//   - Writes debounced at 250ms to avoid write-storm on rapid toggles.
//   - JSON.parse is try/catch wrapped (T-07-02): corrupt blob returns {} silently.
//
// P-13 enforcement: the Plan 09 CI grep asserts only usePrefs.ts may call
// `localStorage.getItem`/`setItem` for the `blade_prefs_v1` key. Feature code
// flows every pref through this hook.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-12, §D-42
// @see .planning/research/PITFALLS.md §P-13

import { useCallback, useRef, useState } from 'react';

const KEY = 'blade_prefs_v1';
const DEBOUNCE_MS = 250;

export interface Prefs {
  /** Route id to land on first boot. Phase 2 Settings writes this. */
  'app.defaultRoute'?: string;
  /** Route id user was on at last unmount — takes precedence over defaultRoute. */
  'app.lastRoute'?: string;
  /** Chat: show per-message timestamps. */
  'chat.showTimestamps'?: boolean;
  /** Chat: expand tool-call blocks inline vs collapsed. */
  'chat.inlineToolCalls'?: boolean;
  /** Ghost Mode: user has acknowledged Linux screen-capture warning. */
  'ghost.linuxWarningAcknowledged'?: boolean;
  /** Forward-compat — other dotted keys accepted as string | number | boolean. */
  [k: string]: string | number | boolean | undefined;
}

function readOnce(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    // T-07-02: corrupt blob — swallow silently, return empty.
    return {};
  }
}

export function usePrefs() {
  // Single read on mount — lazy useState initializer. Never re-reads from storage.
  const [prefs, setPrefs] = useState<Prefs>(() => readOnce());
  const timeout = useRef<number | null>(null);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(p => {
      const next = { ...p, [key]: value };
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => {
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* quota full / private-mode — silent. T-07-05 accepted. */
        }
      }, DEBOUNCE_MS);
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs({});
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
  }, []);

  return { prefs, setPref, resetPrefs };
}
