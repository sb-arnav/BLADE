import { useEffect, useRef } from "react";
import { SearchResult } from "../hooks/useMessageSearch";

interface Props {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  currentIndex: number;
  totalMatches: number;
  currentResult: SearchResult | null;
}

export function MessageSearchBar({
  open,
  query,
  onQueryChange,
  onClose,
  onNext,
  onPrev,
  currentIndex,
  totalMatches,
  currentResult,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onNext();
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) onPrev();
        else onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, onNext, onPrev]);

  if (!open) return null;

  return (
    <div className="absolute top-0 right-0 z-20 m-2 animate-fade-in">
      <div className="bg-blade-surface border border-blade-border rounded-xl shadow-lg p-2 flex items-center gap-2 min-w-[320px]">
        {/* Search icon */}
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-blade-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="5" />
          <line x1="10" y1="10" x2="15" y2="15" />
        </svg>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search messages..."
          className="flex-1 bg-transparent text-xs text-blade-text outline-none placeholder:text-blade-muted"
        />

        {/* Result count */}
        {query && (
          <span className="text-2xs text-blade-muted shrink-0 font-mono">
            {totalMatches > 0 ? `${currentIndex + 1}/${totalMatches}` : "0"}
          </span>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={onPrev}
            disabled={totalMatches === 0}
            className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover disabled:opacity-30 transition-colors"
            title="Previous (Shift+Enter)"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={onNext}
            disabled={totalMatches === 0}
            className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover disabled:opacity-30 transition-colors"
            title="Next (Enter)"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Match preview */}
      {currentResult && (
        <div className="mt-1 bg-blade-surface border border-blade-border rounded-lg px-3 py-2 max-w-[320px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xs text-blade-muted">
              {currentResult.role === "user" ? "You" : "Blade"}
            </span>
            <span className="text-2xs text-blade-muted/50">
              {new Date(currentResult.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className="text-2xs text-blade-secondary leading-relaxed">
            <span className="text-blade-muted">{currentResult.contextBefore}</span>
            <span className="bg-blade-accent/20 text-blade-accent px-0.5 rounded">
              {currentResult.content.slice(currentResult.matchStart, currentResult.matchEnd)}
            </span>
            <span className="text-blade-muted">{currentResult.contextAfter}</span>
          </p>
        </div>
      )}
    </div>
  );
}
