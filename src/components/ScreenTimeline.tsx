import React, { useState, useCallback, useRef, useEffect } from "react";
import { useScreenTimeline, TimelineEntry } from "../hooks/useScreenTimeline";

interface Props {
  onBack: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ThumbnailCard({
  entry,
  onClick,
  getThumbnail,
}: {
  entry: TimelineEntry;
  onClick: () => void;
  getThumbnail: (id: number) => Promise<string>;
}) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const didFetch = useRef(false);

  useEffect(() => {
    if (didFetch.current || !entry.id) return;
    didFetch.current = true;
    getThumbnail(entry.id)
      .then((b64) => setThumbSrc(`data:image/jpeg;base64,${b64}`))
      .catch(() => setThumbSrc(null))
      .finally(() => setLoading(false));
  }, [entry.id, getThumbnail]);

  return (
    <button
      onClick={onClick}
      className="group relative bg-blade-surface border border-blade-border rounded-lg overflow-hidden hover:border-blade-accent/60 transition-all hover:scale-[1.02] text-left"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-blade-border/20 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-blade-accent/40 animate-pulse" />
          </div>
        ) : thumbSrc ? (
          <img
            src={thumbSrc}
            alt={entry.window_title || "Screenshot"}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-blade-muted text-xs">
            No preview
          </div>
        )}
        {/* Time badge */}
        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
          {formatTimestamp(entry.timestamp)}
        </div>
      </div>

      {/* Meta */}
      <div className="p-2 space-y-1">
        <div className="text-xs text-blade-text font-medium truncate">
          {entry.app_name || entry.window_title || "Unknown app"}
        </div>
        {entry.window_title && entry.window_title !== entry.app_name && (
          <div className="text-[10px] text-blade-muted truncate">{entry.window_title}</div>
        )}
        {entry.description && (
          <div className="text-[10px] text-blade-secondary line-clamp-2">{entry.description}</div>
        )}
      </div>
    </button>
  );
}

function LightboxModal({
  entry,
  getScreenshot,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  entry: TimelineEntry;
  getScreenshot: (id: number) => Promise<string>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    setImgSrc(null);
    getScreenshot(entry.id)
      .then((b64) => setImgSrc(`data:image/jpeg;base64,${b64}`))
      .catch(() => setImgSrc(null));
  }, [entry.id, getScreenshot]);

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-blade-bg border border-blade-border rounded-xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-blade-text font-medium truncate">
              {entry.app_name || entry.window_title || "Screenshot"}
            </div>
            <div className="text-xs text-blade-muted">
              {formatDate(entry.timestamp)} at {formatTimestamp(entry.timestamp)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-blade-muted hover:text-blade-text text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Image */}
        <div className="flex-1 overflow-auto min-h-0 bg-black/40">
          {imgSrc ? (
            <img src={imgSrc} alt="Screenshot" className="w-full object-contain" />
          ) : (
            <div className="h-64 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-blade-accent/40 animate-pulse" />
            </div>
          )}
        </div>

        {/* Description + nav */}
        <div className="px-4 py-3 border-t border-blade-border flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {entry.description ? (
              <p className="text-xs text-blade-secondary">{entry.description}</p>
            ) : (
              <p className="text-xs text-blade-muted italic">Describing…</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="px-3 py-1 rounded bg-blade-surface border border-blade-border text-xs text-blade-text disabled:opacity-30 hover:border-blade-accent/60 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="px-3 py-1 rounded bg-blade-surface border border-blade-border text-xs text-blade-text disabled:opacity-30 hover:border-blade-accent/60 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigPanel({
  config,
  stats,
  onUpdate,
}: {
  config: NonNullable<ReturnType<typeof useScreenTimeline>["config"]>;
  stats: NonNullable<ReturnType<typeof useScreenTimeline>["stats"]> | null;
  onUpdate: (changes: { enabled?: boolean; capture_interval_secs?: number; retention_days?: number }) => void;
}) {
  const intervalOptions = [15, 30, 60, 120];
  const retentionOptions = [7, 14, 30];

  return (
    <div className="space-y-4 text-sm">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-blade-text font-medium">Screen Timeline</div>
          <div className="text-xs text-blade-muted mt-0.5">
            Capture screenshots every {config.capture_interval_secs}s and make them searchable
          </div>
        </div>
        <button
          onClick={() => onUpdate({ enabled: !config.enabled })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            config.enabled ? "bg-blade-accent" : "bg-blade-border"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {config.enabled && (
        <>
          {/* Capture interval */}
          <div>
            <div className="text-blade-text text-xs font-medium mb-1">Capture interval</div>
            <div className="flex gap-2">
              {intervalOptions.map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdate({ capture_interval_secs: s })}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${
                    config.capture_interval_secs === s
                      ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                      : "border-blade-border text-blade-muted hover:border-blade-accent/40"
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>

          {/* Retention */}
          <div>
            <div className="text-blade-text text-xs font-medium mb-1">Keep history for</div>
            <div className="flex gap-2">
              {retentionOptions.map((d) => (
                <button
                  key={d}
                  onClick={() => onUpdate({ retention_days: d })}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${
                    config.retention_days === d
                      ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                      : "border-blade-border text-blade-muted hover:border-blade-accent/40"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-blade-border/40">
          <div className="bg-blade-surface rounded-lg p-2.5">
            <div className="text-lg font-medium text-blade-text">{stats.total_entries.toLocaleString()}</div>
            <div className="text-[10px] text-blade-muted">screenshots</div>
          </div>
          <div className="bg-blade-surface rounded-lg p-2.5">
            <div className="text-lg font-medium text-blade-text">{formatBytes(stats.disk_bytes)}</div>
            <div className="text-[10px] text-blade-muted">disk usage</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScreenTimeline({ onBack }: Props) {
  const tl = useScreenTimeline();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      tl.search(tl.searchQuery);
    },
    [tl]
  );

  const openLightbox = (idx: number) => setLightboxIdx(idx);
  const closeLightbox = () => setLightboxIdx(null);

  // Group entries by date for the browse view
  const grouped = React.useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const entry of tl.entries) {
      const key = formatDate(entry.timestamp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries());
  }, [tl.entries]);

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold">Total Recall</div>
          <div className="text-[10px] text-blade-muted">Screen timeline — semantic search over your visual history</div>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
            showSettings
              ? "border-blade-accent text-blade-accent bg-blade-accent/10"
              : "border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-accent/40"
          }`}
        >
          Settings
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && tl.config && (
        <div className="border-b border-blade-border px-4 py-4 bg-blade-surface/50">
          <ConfigPanel config={tl.config} stats={tl.stats} onUpdate={tl.updateConfig} />
        </div>
      )}

      {/* Not enabled notice */}
      {!showSettings && tl.config && !tl.config.enabled && (
        <div className="px-4 py-6 text-center">
          <div className="text-blade-muted text-sm mb-3">Screen Timeline is disabled</div>
          <button
            onClick={() => { setShowSettings(true); }}
            className="text-xs px-4 py-2 rounded bg-blade-accent text-white hover:opacity-90 transition-opacity"
          >
            Enable in Settings
          </button>
        </div>
      )}

      {/* Search + date filter */}
      {tl.config?.enabled && (
        <div className="px-4 py-3 border-b border-blade-border/40 shrink-0 flex gap-2">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <input
              ref={searchInputRef}
              type="text"
              value={tl.searchQuery}
              onChange={(e) => tl.setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  tl.setSearchQuery("");
                  tl.browse(true);
                }
              }}
              placeholder='Search: "error I was debugging", "that Figma design"…'
              className="flex-1 bg-blade-surface border border-blade-border rounded px-3 py-1.5 text-xs placeholder-blade-muted focus:outline-none focus:border-blade-accent/60"
            />
            <button
              type="submit"
              disabled={tl.isSearching}
              className="px-3 py-1.5 rounded bg-blade-accent/90 text-white text-xs hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {tl.isSearching ? "…" : "Search"}
            </button>
          </form>
          <input
            type="date"
            value={tl.selectedDate ?? ""}
            onChange={(e) => {
              tl.setSearchQuery("");
              tl.setSelectedDate(e.target.value || null);
            }}
            className="bg-blade-surface border border-blade-border rounded px-2 py-1.5 text-xs text-blade-text focus:outline-none focus:border-blade-accent/60"
          />
        </div>
      )}

      {/* Grid */}
      {tl.config?.enabled && (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {tl.entries.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-blade-muted text-sm">
              {tl.isSearching ? "Searching…" : "No screenshots yet. BLADE will capture when active."}
            </div>
          ) : (
            <div className="space-y-6 mt-4">
              {grouped.map(([date, dayEntries]) => (
                <div key={date}>
                  <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">{date}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {dayEntries.map((entry) => {
                      const globalIdx = tl.entries.indexOf(entry);
                      return (
                        <ThumbnailCard
                          key={entry.id}
                          entry={entry}
                          onClick={() => openLightbox(globalIdx)}
                          getThumbnail={tl.getThumbnail}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Load more */}
              {tl.hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={tl.loadMore}
                    className="text-xs text-blade-muted hover:text-blade-accent transition-colors"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && tl.entries[lightboxIdx] && (
        <LightboxModal
          entry={tl.entries[lightboxIdx]}
          getScreenshot={tl.getScreenshot}
          onClose={closeLightbox}
          onPrev={() => setLightboxIdx((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setLightboxIdx((i) => Math.min(tl.entries.length - 1, (i ?? 0) + 1))}
          hasPrev={lightboxIdx > 0}
          hasNext={lightboxIdx < tl.entries.length - 1}
        />
      )}
    </div>
  );
}
