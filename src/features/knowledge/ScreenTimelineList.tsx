// src/features/knowledge/ScreenTimelineList.tsx — Phase 5 Plan 05-05
//
// Shared infinite-scroll thumbnail list consumed by both ScreenTimeline
// (KNOW-04) and RewindTimeline (KNOW-05). Pages timeline_browse_cmd 40 entries
// at a time with an IntersectionObserver sentinel; lazy-loads each thumbnail
// via timelineGetThumbnail (assumed base64 per Plan 05-02 wrapper).
//
// T-05-05-04 mitigation: PAGE_SIZE fixed at 40; done-flag stops further
// fetches when a short page comes back; IntersectionObserver uses 200px
// rootMargin for smooth pre-fetch without runaway.
//
// @see .planning/phases/05-agents-knowledge/05-05-PLAN.md Task 1
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-135

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  timelineBrowseCmd,
  timelineGetThumbnail,
  type TimelineEntry,
} from '@/lib/tauri/knowledge';

const PAGE_SIZE = 40;

export interface ScreenTimelineListProps {
  /** Filter accumulated entries to a timestamp window (inclusive). */
  filterTs?: { start?: number; end?: number };
  /** Called when the user clicks a thumbnail row. */
  onEntryClick?: (entry: TimelineEntry) => void;
  /** When true, IntersectionObserver loads the next page automatically. */
  infinite?: boolean;
  /** Override container testid (defaults to "screen-timeline-root"). */
  testid?: string;
}

/**
 * Lazy-loaded thumbnail image. Fetches the base64 payload from
 * `timelineGetThumbnail` on first render, swaps in an <img> once resolved.
 * If the entry already has an inline `screenshot_path` data URL we prefer
 * that to avoid a round-trip.
 */
function TimelineThumb({ entry }: { entry: TimelineEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    timelineGetThumbnail(entry.id)
      .then((data) => {
        if (cancelled) return;
        // Rust returns a base64-encoded JPEG payload (see Plan 05-02 wrapper
        // JSDoc). If the string already carries a data-URL prefix, use it
        // verbatim; otherwise wrap it.
        if (typeof data !== 'string' || data.length === 0) {
          setFailed(true);
          return;
        }
        const url = data.startsWith('data:')
          ? data
          : `data:image/jpeg;base64,${data}`;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  if (failed) {
    return <div className="screen-timeline-thumb-placeholder">no preview</div>;
  }
  if (!src) {
    return <div className="screen-timeline-thumb-placeholder">loading…</div>;
  }
  return <img src={src} alt={entry.window_title || entry.app_name || 'screenshot'} />;
}

function formatHMS(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function ScreenTimelineList({
  filterTs,
  onEntryClick,
  infinite = false,
  testid = 'screen-timeline-root',
}: ScreenTimelineListProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [cursor, setCursor] = useState<number>(0); // offset into timeline_browse_cmd
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guard against double-fires from a single mount (React 18 StrictMode
  // calls effects twice in dev; without this we'd consume cursor=0 twice).
  const initializedRef = useRef(false);

  const loadPage = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    setError(null);
    try {
      const page = await timelineBrowseCmd({ offset: cursor, limit: PAGE_SIZE });
      setEntries((prev) => {
        // De-dupe by id in case the cursor was already advanced beyond a
        // partial page — cheap enough at PAGE_SIZE=40.
        const seen = new Set(prev.map((e) => e.id));
        const next = [...prev];
        for (const e of page) {
          if (!seen.has(e.id)) next.push(e);
        }
        return next;
      });
      setCursor((c) => c + page.length);
      if (page.length < PAGE_SIZE) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Stop the observer from re-triggering on a broken backend.
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [loading, done, cursor]);

  // Initial load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void loadPage();
    // Only run on mount — loadPage identity changes as state advances, but
    // the kickoff is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite-scroll sentinel (T-05-05-04 — 200px rootMargin caps fetch spam).
  useEffect(() => {
    if (!infinite) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entriesObs) => {
        for (const ent of entriesObs) {
          if (ent.isIntersecting) {
            void loadPage();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infinite, loadPage]);

  // Apply client-side timestamp filter.
  const visible = useMemo(() => {
    if (!filterTs || (filterTs.start == null && filterTs.end == null)) return entries;
    return entries.filter((e) => {
      if (filterTs.start != null && e.timestamp < filterTs.start) return false;
      if (filterTs.end != null && e.timestamp > filterTs.end) return false;
      return true;
    });
  }, [entries, filterTs]);

  return (
    <div className="screen-timeline-list" data-testid={testid}>
      {visible.length === 0 && !loading && !error && (
        <div className="screen-timeline-empty">
          No timeline entries yet. Screen capture runs every 30s — check back shortly.
        </div>
      )}
      {visible.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="screen-timeline-thumb"
          data-testid="screen-timeline-thumb"
          onClick={() => onEntryClick?.(entry)}
        >
          <TimelineThumb entry={entry} />
          <div className="screen-timeline-thumb-meta">
            <span>{entry.app_name || '—'}</span>
            <span>{formatHMS(entry.timestamp)}</span>
          </div>
          {entry.window_title ? (
            <div
              className="screen-timeline-thumb-title"
              title={entry.window_title}
            >
              {entry.window_title}
            </div>
          ) : null}
        </button>
      ))}
      {error && (
        <div className="screen-timeline-error" role="alert">
          {error}
        </div>
      )}
      {loading && <div className="screen-timeline-loading">Loading…</div>}
      {infinite && !done && !loading && (
        <div ref={sentinelRef} className="screen-timeline-sentinel" aria-hidden="true" />
      )}
    </div>
  );
}
