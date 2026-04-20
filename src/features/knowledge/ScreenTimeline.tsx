// src/features/knowledge/ScreenTimeline.tsx — Phase 5 Plan 05-05 (KNOW-04).
//
// Infinite-scroll thumbnail browser for Total Recall screenshots. Wraps the
// shared ScreenTimelineList sub-component (also used by RewindTimeline per
// KNOW-05). Header shows timeline_get_stats_cmd counts + a search affordance
// that swaps the list into query mode via timelineSearchCmd.
//
// Clicking a thumbnail opens a Dialog with the full screenshot
// (timeline_get_screenshot) + OCR/description text + window metadata.
// Action items (timelineGetActionItems) are loaded lazily when the entry
// has a meeting_id or other audio signal; kept optional for Phase 5.
//
// prefs['screenTimeline.autoLoadLatest']: when on, scrolls the list to the
// newest entry every 30s via a setInterval refresh.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-135
// @see .planning/REQUIREMENTS.md §KNOW-04

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, GlassPanel, Input } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useRouterCtx } from '@/windows/main/useRouter';
import { CapabilityGap, useCapability } from '@/features/providers';
import {
  timelineGetScreenshot,
  timelineGetStatsCmd,
  timelineSearchCmd,
  type TimelineEntry,
  type TimelineStats,
} from '@/lib/tauri/knowledge';
import { ScreenTimelineList } from './ScreenTimelineList';
import './knowledge.css';
import './knowledge-rich-a.css';

function formatBytes(n: number | undefined | null): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  let v = n;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

function formatTs(ts: number | undefined | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

// Phase 11 Plan 11-05 (PROV-07) — wrapper that guards on vision capability
// BEFORE the inner body mounts its full hook payload. Putting the guard here
// keeps rules-of-hooks clean (no conditional hooks in ScreenTimelineBody).
export function ScreenTimeline() {
  const { hasCapability: hasVision } = useCapability('vision');
  if (!hasVision) {
    return (
      <div style={{ padding: 'var(--s-6)' }} data-testid="screen-timeline-root">
        <CapabilityGap capability="vision" surfaceLabel="Screen Timeline" />
      </div>
    );
  }
  return <ScreenTimelineBody />;
}

function ScreenTimelineBody() {
  const { prefs, setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  const autoLoadLatest =
    typeof prefs['screenTimeline.autoLoadLatest'] === 'boolean'
      ? (prefs['screenTimeline.autoLoadLatest'] as boolean)
      : false;

  const [stats, setStats] = useState<TimelineStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsEpoch, setStatsEpoch] = useState(0);

  // Search mode: when active, render a separate list of timelineSearchCmd
  // results instead of the infinite-scroll browser.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [searchResults, setSearchResults] = useState<TimelineEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Detail dialog state.
  const [selected, setSelected] = useState<TimelineEntry | null>(null);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const [selectedImgError, setSelectedImgError] = useState<string | null>(null);

  // Load stats on mount + whenever autoLoadLatest ticks.
  useEffect(() => {
    let cancelled = false;
    timelineGetStatsCmd()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setStatsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [statsEpoch]);

  // Auto-refresh every 30s when toggle on. We deliberately refresh the stats
  // epoch which triggers a stats reload — the list remounts too via key prop
  // so the newest page is fetched.
  useEffect(() => {
    if (!autoLoadLatest) return;
    const id = window.setInterval(() => {
      setStatsEpoch((e) => e + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [autoLoadLatest]);

  const listKey = useMemo(
    () => `browse-${statsEpoch}`,
    [statsEpoch],
  );

  const runSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const results = await timelineSearchCmd({ query: q, limit: 40 });
      setSearchResults(results);
      setSearchActive(true);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchActive(false);
      setSearchResults([]);
      return;
    }
    void runSearch(trimmed);
  };

  const onEntryClick = useCallback(async (entry: TimelineEntry) => {
    setSelected(entry);
    setSelectedImg(null);
    setSelectedImgError(null);
    try {
      const img = await timelineGetScreenshot(entry.id);
      setSelectedImg(img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`);
    } catch (e) {
      setSelectedImgError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const closeDetail = () => {
    setSelected(null);
    setSelectedImg(null);
    setSelectedImgError(null);
  };

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="screen-timeline-root">
      <header className="screen-timeline-header">
        <h2>Screen Timeline</h2>
        <div className="screen-timeline-header-stats">
          <span>entries: {stats?.total_entries ?? '—'}</span>
          <span>disk: {formatBytes(stats?.disk_bytes ?? 0)}</span>
          <span>oldest: {formatTs(stats?.oldest_timestamp ?? null)}</span>
          <span>newest: {formatTs(stats?.newest_timestamp ?? null)}</span>
        </div>
        <label className="screen-timeline-toggle-row">
          <input
            type="checkbox"
            checked={autoLoadLatest}
            onChange={(e) => setPref('screenTimeline.autoLoadLatest', e.target.checked)}
          />
          Auto-refresh (30s)
        </label>
      </header>

      {statsError && (
        <div className="knowledge-error" role="alert">
          {statsError}
        </div>
      )}

      <form className="screen-timeline-searchbar" onSubmit={onSearchSubmit} role="search">
        <Input
          placeholder="Search timeline (OCR + window titles)…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Timeline search query"
        />
        <Button type="submit" variant="primary">
          {searchLoading ? 'Searching…' : 'Search'}
        </Button>
        {searchActive && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearchActive(false);
              setSearchResults([]);
              setSearchQuery('');
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {searchError && (
        <div className="knowledge-error" role="alert">
          {searchError}
        </div>
      )}

      {searchActive ? (
        <div
          className="screen-timeline-list"
          data-testid="screen-timeline-search-results"
        >
          {searchResults.length === 0 && !searchLoading && (
            <EmptyState
              label="Total Recall not running"
              description="Enable Total Recall from settings to start capturing."
              actionLabel="Open settings"
              onAction={() => openRoute('settings-privacy')}
            />
          )}
          {searchResults.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="screen-timeline-thumb"
              data-testid="screen-timeline-thumb"
              onClick={() => void onEntryClick(entry)}
            >
              <SearchThumbImg entry={entry} />
              <div className="screen-timeline-thumb-meta">
                <span>{entry.app_name || '—'}</span>
                <span>{new Date(entry.timestamp * 1000).toLocaleTimeString()}</span>
              </div>
              {entry.window_title ? (
                <div className="screen-timeline-thumb-title" title={entry.window_title}>
                  {entry.window_title}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <ScreenTimelineList
          key={listKey}
          infinite
          onEntryClick={(e) => void onEntryClick(e)}
        />
      )}

      <Dialog
        open={selected !== null}
        onClose={closeDetail}
        ariaLabel={selected ? `Screen capture at ${formatTs(selected.timestamp)}` : 'Screen capture detail'}
      >
        {selected ? (
          <div className="screen-timeline-detail">
            <header className="screen-timeline-detail-header">
              <h2>{selected.window_title || selected.app_name || 'Screen capture'}</h2>
              <Button variant="ghost" onClick={closeDetail}>
                Close
              </Button>
            </header>
            <div className="screen-timeline-detail-meta">
              <span>app: {selected.app_name || '—'}</span>
              <span>when: {formatTs(selected.timestamp)}</span>
              <span>id: {selected.id}</span>
            </div>
            {selectedImgError && (
              <div className="knowledge-error" role="alert">
                Could not load screenshot: {selectedImgError}
              </div>
            )}
            {selectedImg && (
              <img src={selectedImg} alt={`Screenshot at ${formatTs(selected.timestamp)}`} />
            )}
            {selected.description ? (
              <div className="screen-timeline-detail-ocr">{selected.description}</div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </GlassPanel>
  );
}

/** Inline thumbnail loader used only by the search-result branch (the main
 * browse mode uses ScreenTimelineList which has its own lazy loader). */
function SearchThumbImg({ entry }: { entry: TimelineEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import('@/lib/tauri/knowledge').then(({ timelineGetThumbnail }) =>
      timelineGetThumbnail(entry.id)
        .then((data) => {
          if (cancelled) return;
          if (!data) {
            setFailed(true);
            return;
          }
          setSrc(data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [entry.id]);
  if (failed) return <div className="screen-timeline-thumb-placeholder">no preview</div>;
  if (!src) return <div className="screen-timeline-thumb-placeholder">loading…</div>;
  return <img src={src} alt={entry.window_title || entry.app_name || 'screenshot'} />;
}
