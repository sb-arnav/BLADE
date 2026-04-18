// src/windows/main/useGlobalShortcuts.ts — ⌘K + route shortcuts (D-62).
//
// One keydown listener on window, owned by MainShell (Plan 02-06). Routes with
// a `shortcut` property on their RouteDefinition auto-register — there is no
// per-route registration surface. The `isEditableTarget` guard prevents
// shortcuts from swallowing typing in the palette input, onboarding text
// fields, chat composer, etc. (T-02-05-05 mitigation).
//
// Only ⌘K is allowed to fire inside an editable target — the palette needs to
// open even when focus is inside a form. Everything else bails out early.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-62
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §10

import { useEffect } from 'react';
import { ALL_ROUTES } from '@/windows/main/router';
import { useRouterCtx } from './useRouter';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

function shortcutMatches(def: string, e: KeyboardEvent): boolean {
  // Format: 'Mod+K', 'Mod+Shift+G', 'Alt+Space'. Case-insensitive on the key.
  const parts = def.split('+').map((s) => s.trim());
  let wantMod = false;
  let wantShift = false;
  let wantAlt = false;
  let wantKey = '';
  for (const p of parts) {
    const lp = p.toLowerCase();
    if (lp === 'mod') wantMod = true;
    else if (lp === 'shift') wantShift = true;
    else if (lp === 'alt') wantAlt = true;
    else wantKey = lp;
  }
  const haveMod = e.metaKey || e.ctrlKey;
  if (wantMod !== haveMod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === wantKey;
}

interface UseGlobalShortcutsArgs {
  openPalette: () => void;
}

export function useGlobalShortcuts({ openPalette }: UseGlobalShortcutsArgs) {
  const { openRoute, back, forward } = useRouterCtx();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inEditable = isEditableTarget(e.target);

      // Palette open: allow even inside editable targets
      // (D-58 — native <dialog> has its own focus management).
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openPalette();
        return;
      }

      // Otherwise, don't swallow keys while typing into inputs.
      if (inEditable) return;

      if (mod) {
        if (e.key === '1') {
          e.preventDefault();
          openRoute('dashboard');
          return;
        }
        if (e.key === '/') {
          e.preventDefault();
          openRoute('chat');
          return;
        }
        if (e.key === ',') {
          e.preventDefault();
          openRoute('settings');
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          back();
          return;
        }
        if (e.key === ']') {
          e.preventDefault();
          forward();
          return;
        }
      }

      // Custom RouteDefinition.shortcut overrides — route declares, hook
      // derives. Adding a RouteDefinition.shortcut auto-registers it.
      for (const r of ALL_ROUTES) {
        if (r.shortcut && shortcutMatches(r.shortcut, e)) {
          e.preventDefault();
          openRoute(r.id);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette, openRoute, back, forward]);
}
