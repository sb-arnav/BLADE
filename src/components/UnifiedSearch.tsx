import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnifiedSearch, SearchResult, SearchCategory } from "../hooks/useUnifiedSearch";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
  onSendMessage?: (message: string) => void;
  commands?: { id: string; label: string; shortcut?: string; action: () => void }[];
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function TypeIcon({ type, className }: { type: SearchResult["type"]; className?: string }) {
  const base = className ?? "w-4 h-4";
  switch (type) {
    case "message":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    case "conversation":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          <line x1="9" y1="10" x2="15" y2="10" />
        </svg>
      );
    case "knowledge":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      );
    case "snippet":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "template":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      );
    case "command":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "setting":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    case "agent":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="9" cy="16" r="1" />
          <circle cx="15" cy="16" r="1" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      );
    case "workflow":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    default:
      return <SearchIcon className={base} />;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-blade-accent/20 text-blade-text rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function relativeTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function typeLabel(type: SearchResult["type"]): string {
  const labels: Record<SearchResult["type"], string> = {
    message: "Message",
    conversation: "Conversation",
    knowledge: "Knowledge",
    file: "File",
    snippet: "Snippet",
    template: "Template",
    command: "Command",
    setting: "Setting",
    agent: "Agent",
    workflow: "Workflow",
  };
  return labels[type] ?? type;
}

// ── Category tabs ──────────────────────────────────────────────────────────────

const TAB_ORDER: Array<SearchResult["type"] | "all"> = [
  "all",
  "message",
  "knowledge",
  "file",
  "snippet",
  "template",
  "command",
];

function CategoryTabs({
  categories,
  selected,
  onSelect,
  totalCount,
}: {
  categories: SearchCategory[];
  selected: SearchResult["type"] | "all";
  onSelect: (type: SearchResult["type"] | "all") => void;
  totalCount: number;
}) {
  const catMap = useMemo(() => {
    const map = new Map<string, SearchCategory>();
    for (const c of categories) map.set(c.type, c);
    return map;
  }, [categories]);

  const visibleTabs = useMemo(() => {
    const tabs: Array<{ key: string; label: string; count: number }> = [
      { key: "all", label: "All", count: totalCount },
    ];
    for (const type of TAB_ORDER) {
      if (type === "all") continue;
      const cat = catMap.get(type);
      if (cat && cat.count > 0) {
        tabs.push({ key: type, label: cat.label, count: cat.count });
      }
    }
    // Also include types not in TAB_ORDER
    for (const cat of categories) {
      if (!TAB_ORDER.includes(cat.type) && cat.count > 0) {
        tabs.push({ key: cat.type, label: cat.label, count: cat.count });
      }
    }
    return tabs;
  }, [catMap, categories, totalCount]);

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-blade-border overflow-x-auto scrollbar-none">
      {visibleTabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key as SearchResult["type"] | "all")}
          className={`px-2.5 py-1 rounded-md text-2xs font-medium whitespace-nowrap transition-colors ${
            selected === tab.key
              ? "bg-blade-accent text-white"
              : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
          }`}
        >
          {tab.label}
          <span className="ml-1 opacity-60">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────────────────────────

function SearchSkeleton() {
  return (
    <div className="px-4 py-3 space-y-3 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="w-4 h-4 rounded bg-blade-surface-hover mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-blade-surface-hover rounded w-2/3" />
            <div className="h-3 bg-blade-surface-hover rounded w-full opacity-60" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Result item ────────────────────────────────────────────────────────────────

function ResultItem({
  result,
  query,
  isSelected,
  onSelect,
  onMouseEnter,
}: {
  result: SearchResult;
  query: string;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      data-result-item
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`w-full text-left px-4 py-2 flex items-start gap-3 transition-colors ${
        isSelected
          ? "bg-blade-accent-muted"
          : "hover:bg-blade-surface-hover"
      }`}
    >
      <div className={`mt-0.5 shrink-0 ${isSelected ? "text-blade-accent" : "text-blade-muted"}`}>
        <TypeIcon type={result.type} className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[0.8125rem] font-medium truncate ${isSelected ? "text-blade-text" : "text-blade-secondary"}`}>
            {highlightMatch(result.title, query)}
          </span>
          <span className="text-2xs text-blade-muted/50 font-mono shrink-0 uppercase">
            {typeLabel(result.type)}
          </span>
        </div>
        <p className="text-xs text-blade-muted truncate mt-0.5 leading-relaxed">
          {highlightMatch(result.preview, query)}
        </p>
      </div>
      {result.timestamp && (
        <span className="text-2xs text-blade-muted/40 shrink-0 mt-1">
          {relativeTime(result.timestamp)}
        </span>
      )}
      {isSelected && (
        <kbd className="text-2xs text-blade-muted/50 font-mono shrink-0 mt-1">
          enter
        </kbd>
      )}
    </button>
  );
}

// ── Grouped results ────────────────────────────────────────────────────────────

function GroupedResults({
  results,
  query,
  selectedIndex,
  onSelect,
  onMouseEnter,
}: {
  results: SearchResult[];
  query: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onMouseEnter: (index: number) => void;
}) {
  // Group by type while preserving relevance order
  const groups = useMemo(() => {
    const map = new Map<SearchResult["type"], { results: SearchResult[]; indices: number[] }>();
    results.forEach((r, globalIdx) => {
      if (!map.has(r.type)) {
        map.set(r.type, { results: [], indices: [] });
      }
      map.get(r.type)!.results.push(r);
      map.get(r.type)!.indices.push(globalIdx);
    });
    return map;
  }, [results]);

  // Determine group render order by first appearance
  const orderedTypes = useMemo(() => {
    const seen = new Set<SearchResult["type"]>();
    const order: SearchResult["type"][] = [];
    for (const r of results) {
      if (!seen.has(r.type)) {
        seen.add(r.type);
        order.push(r.type);
      }
    }
    return order;
  }, [results]);

  return (
    <div className="py-1">
      {orderedTypes.map((type) => {
        const group = groups.get(type);
        if (!group) return null;
        return (
          <div key={type}>
            <div className="px-4 pt-2.5 pb-1">
              <span className="text-2xs font-semibold text-blade-muted/60 uppercase tracking-wider">
                {typeLabel(type)}s
              </span>
            </div>
            {group.results.map((result, i) => {
              const globalIndex = group.indices[i];
              return (
                <ResultItem
                  key={result.id}
                  result={result}
                  query={query}
                  isSelected={selectedIndex === globalIndex}
                  onSelect={() => onSelect(globalIndex)}
                  onMouseEnter={() => onMouseEnter(globalIndex)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function UnifiedSearch({ open, onClose, onNavigate, onSendMessage, commands = [] }: Props) {
  const {
    query,
    setQuery,
    results,
    allResults,
    categories,
    isSearching,
    selectedCategory,
    setSelectedCategory,
    recentSearches,
    clearRecent,
    commitSearch,
    isAiMode,
  } = useUnifiedSearch({ commands, onNavigate, onSendMessage });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Focus input on open ───────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, setQuery]);

  // ── Reset selected index on results change ────────────────────────────────

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // ── Scroll selected into view ─────────────────────────────────────────────

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ── Handle result selection ───────────────────────────────────────────────

  const handleSelect = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      commitSearch();
      onClose();
      result.action();
    },
    [results, commitSearch, onClose],
  );

  // ── Handle recent search click ────────────────────────────────────────────

  const handleRecentClick = useCallback(
    (q: string) => {
      setQuery(q);
    },
    [setQuery],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(results.length, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(results.length, 1));
          break;
        case "Enter":
          e.preventDefault();
          if (isAiMode && onSendMessage) {
            const aiQuery = query.trim().slice(1).trim();
            if (aiQuery) {
              onSendMessage(aiQuery);
              onClose();
            }
          } else if (results[selectedIndex]) {
            handleSelect(selectedIndex);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Tab":
          e.preventDefault();
          // Cycle through category tabs
          {
            const types: Array<SearchResult["type"] | "all"> = ["all", ...categories.map((c) => c.type)];
            const currentIdx = types.indexOf(selectedCategory);
            const nextIdx = e.shiftKey
              ? (currentIdx - 1 + types.length) % types.length
              : (currentIdx + 1) % types.length;
            setSelectedCategory(types[nextIdx]);
          }
          break;
      }
    },
    [results, selectedIndex, handleSelect, onClose, isAiMode, query, onSendMessage, categories, selectedCategory, setSelectedCategory],
  );

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const showRecent = !hasQuery && recentSearches.length > 0;
  const showNoResults = hasQuery && !isSearching && results.length === 0 && !isAiMode;
  const showResults = hasQuery && results.length > 0 && !isAiMode;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh]">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-blade-surface border border-blade-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-blade-border">
          <SearchIcon className="w-5 h-5 text-blade-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Search everything... (prefix "?" for AI answer)'
            className="w-full bg-transparent py-3.5 text-sm text-blade-text outline-none placeholder:text-blade-muted"
          />
          {isSearching && (
            <div className="shrink-0">
              <div className="w-4 h-4 border-2 border-blade-accent/30 border-t-blade-accent rounded-full animate-spin" />
            </div>
          )}
          {isAiMode && (
            <span className="text-2xs font-medium text-blade-accent bg-blade-accent/10 px-2 py-0.5 rounded-full shrink-0">
              AI
            </span>
          )}
          <kbd className="text-2xs text-blade-muted/50 font-mono shrink-0">esc</kbd>
        </div>

        {/* AI mode indicator */}
        {isAiMode && hasQuery && (
          <div className="px-4 py-3 border-b border-blade-border bg-blade-accent/5">
            <p className="text-xs text-blade-secondary">
              Press <kbd className="text-2xs font-mono bg-blade-surface-hover px-1.5 py-0.5 rounded mx-0.5">Enter</kbd> to ask AI: <span className="text-blade-text font-medium">{query.slice(1).trim()}</span>
            </p>
          </div>
        )}

        {/* Category tabs (only when there are results) */}
        {showResults && categories.length > 1 && (
          <CategoryTabs
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            totalCount={allResults.length}
          />
        )}

        {/* Content area */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {/* Loading skeleton */}
          {isSearching && results.length === 0 && <SearchSkeleton />}

          {/* Recent searches */}
          {showRecent && (
            <div className="py-2">
              <div className="flex items-center justify-between px-4 pt-1 pb-2">
                <span className="text-2xs font-semibold text-blade-muted/60 uppercase tracking-wider">
                  Recent Searches
                </span>
                <button
                  onClick={clearRecent}
                  className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((recent, i) => (
                <button
                  key={`${recent}-${i}`}
                  onClick={() => handleRecentClick(recent)}
                  className="w-full text-left px-4 py-1.5 text-[0.8125rem] text-blade-secondary hover:bg-blade-surface-hover transition-colors flex items-center gap-2.5"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-blade-muted/40 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {recent}
                </button>
              ))}
            </div>
          )}

          {/* Empty state: no query, no recents */}
          {!hasQuery && !showRecent && (
            <div className="px-4 py-8 text-center">
              <SearchIcon className="w-8 h-8 text-blade-muted/30 mx-auto mb-3" />
              <p className="text-xs text-blade-muted">
                Search messages, knowledge, files, snippets, templates, and commands
              </p>
              <div className="flex items-center justify-center gap-3 mt-3">
                <span className="text-2xs text-blade-muted/40">
                  <kbd className="font-mono bg-blade-surface-hover px-1.5 py-0.5 rounded">arrows</kbd> navigate
                </span>
                <span className="text-2xs text-blade-muted/40">
                  <kbd className="font-mono bg-blade-surface-hover px-1.5 py-0.5 rounded">enter</kbd> select
                </span>
                <span className="text-2xs text-blade-muted/40">
                  <kbd className="font-mono bg-blade-surface-hover px-1.5 py-0.5 rounded">tab</kbd> categories
                </span>
              </div>
            </div>
          )}

          {/* Results */}
          {showResults && (
            <GroupedResults
              results={results}
              query={query}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              onMouseEnter={setSelectedIndex}
            />
          )}

          {/* No results */}
          {showNoResults && (
            <div className="px-4 py-8 text-center">
              <div className="w-10 h-10 rounded-full bg-blade-surface-hover flex items-center justify-center mx-auto mb-3">
                <SearchIcon className="w-5 h-5 text-blade-muted/40" />
              </div>
              <p className="text-sm text-blade-secondary mb-1">
                No results for "<span className="text-blade-text font-medium">{query}</span>"
              </p>
              <p className="text-xs text-blade-muted">
                Try different keywords or prefix with <kbd className="font-mono bg-blade-surface-hover px-1.5 py-0.5 rounded text-2xs">?</kbd> to ask AI
              </p>
              <div className="flex items-center justify-center gap-2 mt-4">
                {["messages", "code", "how to"].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setQuery(suggestion)}
                    className="text-2xs px-2.5 py-1 rounded-full border border-blade-border text-blade-muted hover:text-blade-secondary hover:border-blade-accent/30 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {hasQuery && results.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-blade-border bg-blade-surface/80">
            <span className="text-2xs text-blade-muted/50">
              {results.length} result{results.length !== 1 ? "s" : ""}
              {selectedCategory !== "all" ? ` in ${selectedCategory}` : ""}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-2xs text-blade-muted/40">
                <kbd className="font-mono">up</kbd>/<kbd className="font-mono">down</kbd> navigate
              </span>
              <span className="text-2xs text-blade-muted/40">
                <kbd className="font-mono">enter</kbd> open
              </span>
              <span className="text-2xs text-blade-muted/40">
                <kbd className="font-mono">tab</kbd> filter
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
