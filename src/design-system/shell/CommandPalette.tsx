// src/design-system/shell/CommandPalette.tsx — ⌘K palette (SHELL-03, D-57, D-58).
//
// Reads PALETTE_COMMANDS directly (not a prop) so adding a route auto-surfaces
// with NO App.tsx edit (SC-3 acceptance). Recent route ids tracked in prefs
// under `palette.recent` as a JSON-encoded string (Plan 02-01 Prefs extension;
// D-57). JSON.parse is try/catch-wrapped (T-02-05-01 mitigation) and capped at
// MAX_RECENT entries.
//
// Uses <Dialog> from Phase 1 primitives (native <dialog> element) so focus
// trap + Esc close come for free — no custom focus-trap library (D-58).
//
// Rendering is linear in PALETTE_COMMANDS (~82 today) on every query change;
// useMemo caches the derivation (T-02-05-03 mitigation).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-57, §D-58
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §7

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Dialog } from '@/design-system/primitives';
import { PALETTE_COMMANDS } from '@/windows/main/router';
import type { RouteDefinition } from '@/lib/router';
import { usePrefs } from '@/hooks/usePrefs';
import { useRouterCtx } from '@/windows/main/useRouter';
import { fuzzyScore } from './fuzzy';

const MAX_RECENT = 5;

/** Decode the prefs blob. `palette.recent` is stored as a JSON-encoded string[]. */
function readRecentIds(blob: string | number | boolean | undefined): string[] {
  if (typeof blob !== 'string') return [];
  try {
    const v = JSON.parse(blob);
    return Array.isArray(v) ? v.slice(0, MAX_RECENT).filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // T-02-05-01: corrupt recent blob → empty list, never throws.
    return [];
  }
}
function writeRecentIds(ids: string[]): string {
  return JSON.stringify(ids.slice(0, MAX_RECENT));
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const { prefs, setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<RouteDefinition[]>(() => {
    const recentIds = readRecentIds(prefs['palette.recent']);
    if (!query.trim()) {
      const recent = recentIds
        .map((id) => PALETTE_COMMANDS.find((c) => c.id === id))
        .filter((x): x is RouteDefinition => Boolean(x));
      const rest = PALETTE_COMMANDS.filter((c) => !recentIds.includes(c.id))
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label));
      return [...recent, ...rest];
    }
    return PALETTE_COMMANDS.map((c) => ({ c, s: fuzzyScore(c, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [query, prefs]);

  // Reset selection + clear query on open; focus the input on the next tick
  // (after <dialog>.showModal() has run and the browser has created the
  // top-layer element).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Clamp selection to filtered list so ArrowDown doesn't overshoot after a
  // query narrows the list.
  useEffect(() => {
    if (selectedIdx >= items.length) {
      setSelectedIdx(Math.max(0, items.length - 1));
    }
  }, [items, selectedIdx]);

  function choose(r: RouteDefinition) {
    const prior = readRecentIds(prefs['palette.recent']);
    const next = [r.id, ...prior.filter((x) => x !== r.id)].slice(0, MAX_RECENT);
    setPref('palette.recent', writeRecentIds(next));
    openRoute(r.id);
    onClose();
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = items[selectedIdx];
      if (r) choose(r);
    }
    // Esc closes via native <dialog> cancel event → Dialog onClose → our onClose
  }

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Command palette">
      <div className="palette" onKeyDown={onKey}>
        <input
          ref={inputRef}
          type="text"
          className="palette-input"
          placeholder="Search routes…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          aria-label="Search routes"
          autoFocus
        />
        <div className="palette-list" role="listbox">
          {items.length === 0 && <div className="palette-empty">No matches.</div>}
          {items.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === selectedIdx}
              className={`palette-row ${i === selectedIdx ? 'selected' : ''}`}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => choose(r)}
              data-route-id={r.id}
            >
              <span className="palette-row-label">{r.label}</span>
              {r.description && (
                <span className="palette-row-desc">{r.description}</span>
              )}
              {r.shortcut && (
                <span className="palette-row-kbd">
                  <kbd>{r.shortcut.replace('Mod', '⌘')}</kbd>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
