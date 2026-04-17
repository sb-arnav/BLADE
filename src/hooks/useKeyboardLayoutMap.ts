import { useMemo } from "react";

/**
 * Complete keyboard shortcut map for Blade.
 * Central registry of all shortcuts across the app.
 */

export interface ShortcutEntry {
  keys: string;
  description: string;
  category: string;
  action: string;
  global: boolean;       // works everywhere vs only in specific context
  context?: string;      // where this shortcut is active
}

const SHORTCUTS: ShortcutEntry[] = [
  // Global navigation
  { keys: "Alt+Space", description: "Toggle Blade window", category: "Navigation", action: "toggle-window", global: true },
  { keys: "Ctrl+K", description: "Open command palette", category: "Navigation", action: "palette", global: true },
  { keys: "Ctrl+N", description: "New conversation", category: "Navigation", action: "new-conversation", global: true },
  { keys: "Ctrl+,", description: "Open settings", category: "Navigation", action: "settings", global: true },
  { keys: "Ctrl+L", description: "Focus input", category: "Navigation", action: "focus-input", global: true },
  { keys: "Ctrl+F", description: "Focus mode", category: "Navigation", action: "focus-mode", global: true },
  { keys: "Ctrl+/", description: "Keyboard shortcuts", category: "Navigation", action: "shortcuts", global: true },
  { keys: "Escape", description: "Hide window / close modal", category: "Navigation", action: "escape", global: true },

  // Chat
  { keys: "Enter", description: "Send message", category: "Chat", action: "send", global: false, context: "chat-input" },
  { keys: "Shift+Enter", description: "New line", category: "Chat", action: "newline", global: false, context: "chat-input" },
  { keys: "/", description: "Slash command", category: "Chat", action: "slash", global: false, context: "chat-input" },
  { keys: "Ctrl+V", description: "Paste image", category: "Chat", action: "paste-image", global: false, context: "chat-input" },
  { keys: "Double-click", description: "Copy message", category: "Chat", action: "copy-message", global: false, context: "message" },

  // Editing
  { keys: "Ctrl+B", description: "Bold", category: "Editing", action: "bold", global: false, context: "rich-editor" },
  { keys: "Ctrl+I", description: "Italic", category: "Editing", action: "italic", global: false, context: "rich-editor" },
  { keys: "Ctrl+Shift+C", description: "Code", category: "Editing", action: "code", global: false, context: "rich-editor" },
  { keys: "Ctrl+Enter", description: "Submit", category: "Editing", action: "submit", global: false, context: "rich-editor" },
  { keys: "Ctrl+S", description: "Save", category: "Editing", action: "save", global: false, context: "editor" },

  // Terminal
  { keys: "Ctrl+L", description: "Clear terminal", category: "Terminal", action: "clear-terminal", global: false, context: "terminal" },
  { keys: "Up/Down", description: "Command history", category: "Terminal", action: "history", global: false, context: "terminal" },

  // Canvas
  { keys: "Tab", description: "Add sibling node", category: "Canvas", action: "add-sibling", global: false, context: "canvas" },
  { keys: "Enter", description: "Add child node", category: "Canvas", action: "add-child", global: false, context: "canvas" },
  { keys: "Delete", description: "Delete selected", category: "Canvas", action: "delete", global: false, context: "canvas" },
  { keys: "Ctrl+Z", description: "Undo", category: "Canvas", action: "undo", global: false, context: "canvas" },
  { keys: "Ctrl+Y", description: "Redo", category: "Canvas", action: "redo", global: false, context: "canvas" },
  { keys: "Space", description: "Pan mode", category: "Canvas", action: "pan", global: false, context: "canvas" },

  // Study
  { keys: "Space", description: "Flip flashcard", category: "Study", action: "flip", global: false, context: "flashcard" },
  { keys: "1", description: "Again", category: "Study", action: "again", global: false, context: "flashcard-review" },
  { keys: "2", description: "Hard", category: "Study", action: "hard", global: false, context: "flashcard-review" },
  { keys: "3", description: "Good", category: "Study", action: "good", global: false, context: "flashcard-review" },
  { keys: "4", description: "Easy", category: "Study", action: "easy", global: false, context: "flashcard-review" },

  // Search
  { keys: "Ctrl+Shift+F", description: "Search messages", category: "Search", action: "search-messages", global: true },
  { keys: "Enter", description: "Next result", category: "Search", action: "next-result", global: false, context: "search" },
  { keys: "Shift+Enter", description: "Previous result", category: "Search", action: "prev-result", global: false, context: "search" },

  // Voice
  { keys: "Click mic", description: "Start/stop recording", category: "Voice", action: "voice-toggle", global: false, context: "input-bar" },

  // Window
  { keys: "Ctrl+1-6", description: "Switch space", category: "Spaces", action: "switch-space", global: true },
];

export function useKeyboardLayoutMap() {
  const categories = useMemo(() => {
    const cats = new Map<string, ShortcutEntry[]>();
    for (const shortcut of SHORTCUTS) {
      if (!cats.has(shortcut.category)) cats.set(shortcut.category, []);
      cats.get(shortcut.category)!.push(shortcut);
    }
    return Array.from(cats.entries()).map(([name, shortcuts]) => ({ name, shortcuts }));
  }, []);

  const globalShortcuts = useMemo(() => SHORTCUTS.filter((s) => s.global), []);

  const getForContext = useMemo(() => {
    return (context: string) => SHORTCUTS.filter((s) => s.context === context || s.global);
  }, []);

  const search = useMemo(() => {
    return (query: string) => {
      const lower = query.toLowerCase();
      return SHORTCUTS.filter((s) =>
        s.keys.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower),
      );
    };
  }, []);

  return {
    shortcuts: SHORTCUTS,
    categories,
    globalShortcuts,
    getForContext,
    search,
  };
}
