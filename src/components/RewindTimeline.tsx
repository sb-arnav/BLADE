/**
 * REWIND TIMELINE — Scrub through your day as a visual timeline.
 * Ported from Omi's RewindTimelineView + RewindPage.
 *
 * Features:
 *   - Horizontal timeline bar showing activity through the day
 *   - App icon markers showing which apps were used when
 *   - Hover to preview screenshot thumbnails
 *   - Click to jump to any moment
 *   - Search across all screenshots by description
 *   - Keyboard navigation (← → arrows)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface TimelineEntry {
  id: number;
  timestamp: number;
  screenshot_path: string;
  thumbnail_path: string;
  window_title: string;
  app_name: string;
  description: string;
  fingerprint: number;
}

interface RewindTimelineProps {
  onBack: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimeShort(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RewindTimeline({ onBack }: RewindTimelineProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TimelineEntry[]>([]);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  });
  const [loading, setLoading] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Load entries for the selected date
  useEffect(() => {
    setLoading(true);
    invoke<TimelineEntry[]>("timeline_browse_cmd", { date, offset: 0, limit: 500 })
      .then((items) => {
        setEntries(items);
        if (items.length > 0) setSelectedIndex(items.length - 1);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [date]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      invoke<TimelineEntry[]>("timeline_search_cmd", { query: searchQuery, limit: 20 })
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && selectedIndex !== null && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (e.key === "ArrowRight" && selectedIndex !== null && selectedIndex < entries.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (e.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIndex, entries.length, onBack]);

  const selectedEntry = selectedIndex !== null ? entries[selectedIndex] : null;

  // Group entries by app for the icon bar
  const appRuns = entries.reduce<Array<{ app: string; startIdx: number; endIdx: number }>>((acc, entry, idx) => {
    const last = acc[acc.length - 1];
    if (last && last.app === entry.app_name) {
      last.endIdx = idx;
    } else {
      acc.push({ app: entry.app_name, startIdx: idx, endIdx: idx });
    }
    return acc;
  }, []);

  const changeDate = useCallback((delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().split("T")[0]);
  }, [date]);

  return (
    <div className="flex flex-col h-full bg-blade-bg text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-white transition-colors text-sm">
            ← Back
          </button>
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Rewind</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDate(-1)} className="px-2 py-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white">◀</button>
          <span className="text-xs text-[rgba(255,255,255,0.6)] font-mono">{date}</span>
          <button onClick={() => changeDate(1)} className="px-2 py-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white">▶</button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-5 py-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search screenshots... (e.g. 'error in auth.rs')"
          className="w-full px-3 py-[6px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded-lg text-xs text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8]"
        />
      </div>

      {/* Search results filmstrip */}
      {searchResults.length > 0 && (
        <div className="px-5 py-2 border-b border-[rgba(255,255,255,0.06)]">
          <div className="text-[10px] text-[rgba(255,255,255,0.3)] mb-1">{searchResults.length} results</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {searchResults.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  const idx = entries.findIndex((e) => e.id === r.id);
                  if (idx >= 0) setSelectedIndex(idx);
                }}
                className="flex-shrink-0 w-[80px] h-[50px] rounded-md overflow-hidden border border-[rgba(255,255,255,0.1)] hover:border-[#818cf8] transition-colors"
              >
                <img
                  src={convertFileSrc(r.thumbnail_path)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main screenshot view */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        {selectedEntry ? (
          <div className="flex flex-col items-center gap-2 max-h-full">
            <img
              src={convertFileSrc(selectedEntry.screenshot_path)}
              alt=""
              className="max-h-[calc(100vh-280px)] max-w-full rounded-lg border border-[rgba(255,255,255,0.1)] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "";
                (e.target as HTMLImageElement).alt = "Screenshot unavailable";
              }}
            />
            <div className="text-center">
              <div className="text-xs text-[rgba(255,255,255,0.6)]">
                {formatTime(selectedEntry.timestamp)} — {selectedEntry.app_name}
                {selectedEntry.window_title && ` — ${selectedEntry.window_title.substring(0, 60)}`}
              </div>
              {selectedEntry.description && (
                <div className="text-[10px] text-[rgba(255,255,255,0.35)] mt-1 max-w-[500px]">
                  {selectedEntry.description.substring(0, 150)}
                </div>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="text-sm text-[rgba(255,255,255,0.3)]">Loading timeline...</div>
        ) : (
          <div className="text-sm text-[rgba(255,255,255,0.3)]">No screenshots for this date</div>
        )}
      </div>

      {/* App icon bar */}
      {entries.length > 0 && (
        <div className="px-5 py-1 flex gap-[2px] overflow-hidden">
          {appRuns.slice(0, 30).map((run, i) => {
            const width = Math.max(((run.endIdx - run.startIdx + 1) / entries.length) * 100, 2);
            return (
              <div
                key={i}
                className="h-[3px] rounded-full"
                style={{
                  width: `${width}%`,
                  background: selectedIndex !== null && selectedIndex >= run.startIdx && selectedIndex <= run.endIdx
                    ? "#818cf8"
                    : "rgba(255,255,255,0.15)",
                }}
                title={run.app}
              />
            );
          })}
        </div>
      )}

      {/* Timeline scrubber */}
      <div
        ref={timelineRef}
        className="px-5 py-3 border-t border-[rgba(255,255,255,0.08)] cursor-pointer"
        onMouseMove={(e) => {
          if (!timelineRef.current || entries.length === 0) return;
          const rect = timelineRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left - 20; // account for padding
          const ratio = Math.max(0, Math.min(1, x / (rect.width - 40)));
          const idx = Math.round(ratio * (entries.length - 1));
          setHoveredIndex(idx);
        }}
        onMouseLeave={() => setHoveredIndex(null)}
        onClick={() => {
          if (hoveredIndex !== null) setSelectedIndex(hoveredIndex);
        }}
      >
        {/* Time markers */}
        <div className="flex justify-between text-[9px] text-[rgba(255,255,255,0.25)] mb-1">
          {entries.length > 0 && (
            <>
              <span>{formatTimeShort(entries[0].timestamp)}</span>
              {entries.length > 2 && <span>{formatTimeShort(entries[Math.floor(entries.length / 2)].timestamp)}</span>}
              <span>{formatTimeShort(entries[entries.length - 1].timestamp)}</span>
            </>
          )}
        </div>

        {/* Scrubber bar */}
        <div className="relative h-[40px] bg-[rgba(255,255,255,0.04)] rounded-lg overflow-hidden">
          {/* Activity density visualization */}
          {entries.length > 0 && (
            <div className="absolute inset-0 flex">
              {Array.from({ length: 48 }, (_, i) => {
                const sliceStart = Math.floor((i / 48) * entries.length);
                const sliceEnd = Math.floor(((i + 1) / 48) * entries.length);
                const count = sliceEnd - sliceStart;
                const opacity = Math.min(count / 3, 1) * 0.4;
                return (
                  <div
                    key={i}
                    className="flex-1"
                    style={{ background: `rgba(129,140,248,${opacity})` }}
                  />
                );
              })}
            </div>
          )}

          {/* Selected position */}
          {selectedIndex !== null && entries.length > 0 && (
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[#818cf8] z-10"
              style={{ left: `${(selectedIndex / (entries.length - 1)) * 100}%` }}
            />
          )}

          {/* Hover position */}
          {hoveredIndex !== null && entries.length > 0 && (
            <>
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-white/40 z-10"
                style={{ left: `${(hoveredIndex / (entries.length - 1)) * 100}%` }}
              />
              {/* Hover tooltip */}
              <div
                className="absolute -top-[60px] z-20 pointer-events-none"
                style={{ left: `${(hoveredIndex / (entries.length - 1)) * 100}%`, transform: "translateX(-50%)" }}
              >
                {entries[hoveredIndex] && (
                  <div className="bg-[#1a1a24] border border-[rgba(255,255,255,0.15)] rounded-md p-1 shadow-xl">
                    <img
                      src={convertFileSrc(entries[hoveredIndex].thumbnail_path)}
                      alt=""
                      className="w-[120px] h-[70px] rounded object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="text-[9px] text-[rgba(255,255,255,0.5)] mt-1 text-center">
                      {formatTime(entries[hoveredIndex].timestamp)}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Entry count */}
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[rgba(255,255,255,0.2)]">
            {entries.length} screenshots · ← → to navigate
          </span>
          {selectedIndex !== null && (
            <span className="text-[9px] text-[rgba(255,255,255,0.3)]">
              {selectedIndex + 1}/{entries.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
