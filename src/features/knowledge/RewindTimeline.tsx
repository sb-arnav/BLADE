// src/features/knowledge/RewindTimeline.tsx — Phase 5 Plan 05-05 (KNOW-05).
//
// Reuses the shared ScreenTimelineList sub-component and adds a playback
// slider on top. The slider spans [oldest_ts, newest_ts] from
// timelineGetStatsCmd; dragging it narrows the list via a filterTs window.
// A play/pause button auto-advances the slider every 500ms in 1% steps.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-135 (shared list)
// @see .planning/REQUIREMENTS.md §KNOW-05

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, GlassPanel } from '@/design-system/primitives';
import {
  timelineGetScreenshot,
  timelineGetStatsCmd,
  type TimelineEntry,
  type TimelineStats,
} from '@/lib/tauri/knowledge';
import { ScreenTimelineList } from './ScreenTimelineList';
import './knowledge.css';
import './knowledge-rich-a.css';

/** Window size (seconds) around the slider focus timestamp. */
const WINDOW_SECS = 5 * 60; // ±5 minutes
const PLAY_STEP_MS = 500;

function formatClock(ts: number | undefined | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${d.toLocaleDateString()} ${hh}:${mm}:${ss}`;
}

export function RewindTimeline() {
  const [stats, setStats] = useState<TimelineStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [position, setPosition] = useState(100); // 0..100
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<TimelineEntry | null>(null);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    timelineGetStatsCmd()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setStatsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const oldest = stats?.oldest_timestamp ?? null;
  const newest = stats?.newest_timestamp ?? null;
  const spanValid = oldest != null && newest != null && newest > oldest;

  const focusTs = useMemo(() => {
    if (!spanValid) return null;
    const pct = Math.max(0, Math.min(100, position));
    const range = (newest as number) - (oldest as number);
    return (oldest as number) + (range * pct) / 100;
  }, [position, oldest, newest, spanValid]);

  const filterTs = useMemo(() => {
    if (focusTs == null) return undefined;
    return { start: focusTs - WINDOW_SECS, end: focusTs + WINDOW_SECS };
  }, [focusTs]);

  // Play/pause auto-advance.
  useEffect(() => {
    if (!playing || !spanValid) {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setPosition((p) => {
        const next = p + 1; // 1% step per 500ms
        if (next >= 100) {
          setPlaying(false);
          return 100;
        }
        return next;
      });
    }, PLAY_STEP_MS);
    return () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, spanValid]);

  const onEntryClick = useCallback(async (entry: TimelineEntry) => {
    setSelected(entry);
    setSelectedImg(null);
    try {
      const img = await timelineGetScreenshot(entry.id);
      setSelectedImg(img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`);
    } catch {
      // Swallow — the thumb view continues to work without the full image.
    }
  }, []);

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="rewind-timeline-root">
      <header className="screen-timeline-header">
        <h2>Rewind</h2>
        <div className="screen-timeline-header-stats">
          <span>entries: {stats?.total_entries ?? '—'}</span>
          <span>window: ±{WINDOW_SECS / 60}m</span>
        </div>
      </header>

      {statsError && (
        <div className="knowledge-error" role="alert">
          {statsError}
        </div>
      )}

      <div className="rewind-timeline-slider">
        <div className="rewind-timeline-slider-stats">
          <span>oldest · {formatClock(oldest)}</span>
          <span>newest · {formatClock(newest)}</span>
        </div>
        <div className="rewind-timeline-slider-row">
          <Button
            variant={playing ? 'primary' : 'secondary'}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause playback' : 'Start playback'}
            disabled={!spanValid}
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={position}
            disabled={!spanValid}
            onChange={(e) => {
              setPosition(Number(e.target.value));
              if (playing) setPlaying(false);
            }}
            aria-label="Rewind position"
          />
          <span className="rewind-timeline-slider-label">
            {focusTs != null ? formatClock(focusTs) : 'no data'}
          </span>
        </div>
      </div>

      {spanValid ? (
        <ScreenTimelineList
          infinite
          filterTs={filterTs}
          onEntryClick={(e) => void onEntryClick(e)}
        />
      ) : (
        <div className="knowledge-graph-empty">
          No timeline entries yet. Rewind activates once Total Recall has captured
          at least one screenshot.
        </div>
      )}

      {selected && (
        <aside className="rewind-timeline-preview">
          {selectedImg ? (
            <img
              src={selectedImg}
              alt={
                selected.window_title ||
                selected.app_name ||
                `capture at ${formatClock(selected.timestamp)}`
              }
              style={{
                maxWidth: '100%',
                maxHeight: 400,
                objectFit: 'contain',
                display: 'block',
                margin: '12px auto',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line)',
              }}
            />
          ) : null}
        </aside>
      )}
    </GlassPanel>
  );
}
