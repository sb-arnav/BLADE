import { useEffect, useRef, useState, useCallback } from "react";

interface Command {
  id: string;
  label: string;
  description?: string;
  section?: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  commands: Command[];
  open: boolean;
  onClose: () => void;
}

const RECENT_KEY = "blade-palette-recent";
const MAX_RECENT = 5;

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordRecentId(id: string) {
  try {
    const prev = loadRecentIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal
  }
}

/**
 * Fuzzy-score a command against a query string.
 * Returns a score >= 0 (higher = better match), or -1 if there is no match.
 * Strategy:
 *   - Exact substring match in label → highest score
 *   - All query chars appear in label in order (fuzzy) → medium score
 *   - Substring match in description → low score
 */
function fuzzyScore(cmd: Command, q: string): number {
  if (!q) return 0;
  const label = cmd.label.toLowerCase();
  const desc = (cmd.description ?? "").toLowerCase();
  const query = q.toLowerCase();

  // Exact label substring match
  if (label.includes(query)) return 100 + (1 - query.length / label.length) * 10;

  // Fuzzy: all characters present in label in order
  let qi = 0;
  let consecutive = 0;
  let maxConsec = 0;
  for (let i = 0; i < label.length && qi < query.length; i++) {
    if (label[i] === query[qi]) {
      qi++;
      consecutive++;
      maxConsec = Math.max(maxConsec, consecutive);
    } else {
      consecutive = 0;
    }
  }
  if (qi === query.length) {
    // Scored by ratio of consecutive matches to length of query
    return 50 + (maxConsec / query.length) * 20;
  }

  // Description match
  if (desc.includes(query)) return 20;

  return -1; // no match
}

export function CommandPalette({ commands, open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reload recent IDs whenever the palette opens
  useEffect(() => {
    if (open) {
      setRecentIds(loadRecentIds());
    }
  }, [open]);

  // Compute filtered + scored list
  const filtered: Command[] = query
    ? commands
        .map((c) => ({ cmd: c, score: fuzzyScore(c, query) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.cmd)
    : commands;

  // Build recent commands section (only when not searching)
  const recentCommands: Command[] = !query
    ? recentIds
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Command => c !== undefined)
    : [];

  const grouped = filtered.reduce<Array<{ key: string; label: string; commands: Command[] }>>((acc, command) => {
    const key = command.section || "Blade";
    const existing = acc.find((group) => group.key === key);
    if (existing) {
      existing.commands.push(command);
    } else {
      acc.push({ key, label: key, commands: [command] });
    }
    return acc;
  }, []);

  // Flat list including recents at top for keyboard nav indexing
  const flatFiltered: Command[] = !query && recentCommands.length > 0
    ? [...recentCommands, ...filtered.filter((c) => !recentCommands.some((r) => r.id === c.id))]
    : filtered;

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

  const handleSelect = useCallback((cmd: Command) => {
    recordRecentId(cmd.id);
    setRecentIds(loadRecentIds());
    onClose();
    cmd.action();
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const hasResults = flatFiltered.length > 0;
    switch (e.key) {
      case "ArrowDown":
        if (!hasResults) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % flatFiltered.length);
        break;
      case "ArrowUp":
        if (!hasResults) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + flatFiltered.length) % flatFiltered.length);
        break;
      case "Enter":
        if (!hasResults) return;
        e.preventDefault();
        if (flatFiltered[selectedIndex]) handleSelect(flatFiltered[selectedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  const renderCmd = (cmd: Command) => {
    const i = flatFiltered.findIndex((item) => item.id === cmd.id);
    return (
      <button
        key={cmd.id}
        data-cmd
        onClick={() => handleSelect(cmd)}
        onMouseEnter={() => setSelectedIndex(i)}
        className={`w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between gap-3 ${
          i === selectedIndex
            ? "bg-blade-accent-muted text-blade-text"
            : "text-blade-secondary"
        }`}
      >
        <div className="min-w-0">
          <div className="text-[0.8125rem] truncate">{cmd.label}</div>
          {cmd.description ? (
            <div className="text-2xs text-blade-muted mt-0.5 truncate">{cmd.description}</div>
          ) : null}
        </div>
        {cmd.shortcut && (
          <kbd className="text-2xs text-blade-muted font-mono shrink-0">{cmd.shortcut}</kbd>
        )}
      </button>
    );
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
            placeholder="Ask Blade to open or do something..."
            className="w-full bg-transparent py-2.5 text-[0.8125rem] text-blade-text outline-none placeholder:text-blade-muted"
          />
          <kbd className="text-2xs text-blade-muted/50 font-mono shrink-0">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {flatFiltered.length === 0 && (
            <p className="px-4 py-3 text-xs text-blade-muted">No results.</p>
          )}

          {/* Recent commands — only shown when not searching */}
          {!query && recentCommands.length > 0 && (
            <div className="py-1">
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-blade-muted/70">
                Recent
              </div>
              {recentCommands.map(renderCmd)}
            </div>
          )}

          {/* All commands grouped by section */}
          {grouped.map((group) => (
            <div key={group.key} className="py-1">
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-blade-muted/70">
                {group.label}
              </div>
              {group.commands
                // When not searching, skip commands already shown in Recent
                .filter((cmd) => query || !recentCommands.some((r) => r.id === cmd.id))
                .map(renderCmd)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
