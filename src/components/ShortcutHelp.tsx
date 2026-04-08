import { useEffect } from "react";

const shortcuts = [
  { description: "New conversation", keys: "Ctrl+N" },
  { description: "Command palette", keys: "Ctrl+K" },
  { description: "Settings", keys: "Ctrl+," },
  { description: "Focus input", keys: "Ctrl+L" },
  { description: "Hide window", keys: "Esc" },
  { description: "Voice input", keys: "Click mic" },
  { description: "Screenshot", keys: "Click camera" },
  { description: "Copy message", keys: "Double-click" },
  { description: "Drop file", keys: "Drag & drop" },
];

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
        <h2 className="text-sm font-semibold mb-4">Keyboard Shortcuts</h2>
        <div className="flex flex-col gap-2">
          {shortcuts.map(({ description, keys }) => (
            <div key={description} className="flex items-center justify-between">
              <span className="text-xs text-blade-secondary">{description}</span>
              <kbd className="font-mono text-2xs bg-blade-bg px-1.5 py-0.5 rounded text-blade-muted">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
