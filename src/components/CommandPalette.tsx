import { useEffect, useRef, useState } from "react";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  commands: Command[];
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ commands, open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-cmd]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  const handleSelect = (cmd: Command) => {
    onClose();
    cmd.action();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) handleSelect(filtered[selectedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md bg-blade-surface border border-blade-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="flex items-center gap-2.5 px-4 border-b border-blade-border">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-blade-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="w-full bg-transparent py-2.5 text-[0.8125rem] text-blade-text outline-none placeholder:text-blade-muted"
          />
          <kbd className="text-2xs text-blade-muted/50 font-mono shrink-0">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-xs text-blade-muted">No results.</p>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              data-cmd
              onClick={() => handleSelect(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-4 py-2 text-[0.8125rem] transition-colors flex items-center justify-between ${
                i === selectedIndex
                  ? "bg-blade-accent-muted text-blade-text"
                  : "text-blade-secondary"
              }`}
            >
              <span>{cmd.label}</span>
              {cmd.shortcut && (
                <kbd className="text-2xs text-blade-muted font-mono">{cmd.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
