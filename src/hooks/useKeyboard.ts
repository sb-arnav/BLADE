import { useEffect } from 'react';

export interface KeyboardActions {
  onNewConversation?: () => void;
  onSettings?: () => void;
  onToggleSidebar?: () => void;
  onFocusInput?: () => void;
  onPalette?: () => void;
  onEscape?: () => void;
}

const ALWAYS_ACTIVE_KEYS = new Set(['Escape', 'k']);

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      const isEditable =
        tagName === 'input' || tagName === 'textarea' || target.isContentEditable;

      const key = e.key.toLowerCase();

      // In editable fields, only allow Escape and Ctrl+K
      if (isEditable && !(key === 'escape' || (e.ctrlKey && ALWAYS_ACTIVE_KEYS.has(key)))) {
        return;
      }

      if (key === 'escape') {
        actions.onEscape?.();
        return;
      }

      if (!e.ctrlKey || e.shiftKey || e.altKey) return;

      const shortcut: Record<string, (() => void) | undefined> = {
        n: actions.onNewConversation,
        ',': actions.onSettings,
        b: actions.onToggleSidebar,
        l: actions.onFocusInput,
        k: actions.onPalette,
      };

      const handler = shortcut[key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions]);
}
