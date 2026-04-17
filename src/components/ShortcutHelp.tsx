import { useEffect } from "react";

const SHORTCUTS = [
  { section: "Chat", description: "New conversation", keys: "Ctrl+N" },
  { section: "Chat", description: "Command palette", keys: "Ctrl+K" },
  { section: "Chat", description: "Focus input", keys: "Ctrl+L" },
  { section: "Chat", description: "Conversation branches", keys: "Ctrl+B" },
  { section: "Chat", description: "Distraction-free mode", keys: "Ctrl+F" },
  { section: "Chat", description: "Settings", keys: "Ctrl+," },
  { section: "Chat", description: "This cheat sheet", keys: "Ctrl+/" },
  { section: "Messages", description: "Copy message text", keys: "Double-click" },
  { section: "Messages", description: "Rename conversation", keys: "Double-click title" },
  { section: "Input", description: "Send message", keys: "Enter" },
  { section: "Input", description: "New line", keys: "Shift+Enter" },
  { section: "Input", description: "Slash commands", keys: "/ then Tab" },
  { section: "Input", description: "Paste image", keys: "Ctrl+V" },
  { section: "Input", description: "Voice input", keys: "Click mic" },
  { section: "Input", description: "Screenshot", keys: "Click camera" },
  { section: "Window", description: "Hide window", keys: "Esc" },
];

// Group by section
const grouped = SHORTCUTS.reduce<Array<{ section: string; items: typeof SHORTCUTS }>>((acc, s) => {
  const g = acc.find((g) => g.section === s.section);
  if (g) g.items.push(s);
  else acc.push({ section: s.section, items: [s] });
  return acc;
}, []);

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="max-w-sm w-full bg-blade-surface border border-blade-border rounded-2xl p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <kbd className="text-2xs text-blade-muted/50 font-mono">esc to close</kbd>
        </div>
        <div className="space-y-4">
          {grouped.map(({ section, items }) => (
            <div key={section}>
              <div className="text-[9px] uppercase tracking-[0.2em] text-blade-muted/40 mb-2 font-semibold">
                {section}
              </div>
              <div className="space-y-1.5">
                {items.map(({ description, keys }) => (
                  <div key={description} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-blade-secondary">{description}</span>
                    <kbd className="font-mono text-2xs bg-blade-bg px-1.5 py-0.5 rounded text-blade-muted shrink-0">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
