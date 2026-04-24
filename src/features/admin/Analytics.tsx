// src/features/admin/Analytics.tsx — Plan 07-05 Task 1 (ADMIN-01).
//
// Real body per D-182 — 4-panel dashboard:
//   1. Hero KPI row: dbAnalyticsSummary total_events + by_type breakdown.
//   2. Events feed: dbEventsSince(last 24h) as reverse-chrono list.
//   3. Track event debug form: dbTrackEvent({ event_type, metadata }) + toast.
//   4. Prune controls: Dialog-confirm → dbPruneAnalytics(older_than_days).
//
// Rust shape corrections (per Plan 07-02 SUMMARY):
//   - dbEventsSince takes a flat `since: number` (epoch millis), not an
//     `{ since, limit }` object. We slice client-side to cap display at 100.
//   - dbPruneAnalytics takes a flat `olderThanDays: number` and returns
//     a count (usize → number).
//   - db_track_event takes `{ event_type: String, metadata: Option<String> }`
//     — metadata is a JSON string (stringified client-side), not a parsed blob.
//   - dbAnalyticsSummary returns an opaque serde_json::Value; we tolerate
//     any shape via Record<string, unknown>.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-182
// @see src/lib/tauri/admin.ts (dbAnalyticsSummary, dbEventsSince,
//      dbTrackEvent, dbPruneAnalytics wrappers)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, Input, GlassSpinner, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  dbAnalyticsSummary,
  dbEventsSince,
  dbTrackEvent,
  dbPruneAnalytics,
} from '@/lib/tauri/admin';
import type { AnalyticsEvent, AnalyticsSummary } from './types';
import './admin.css';
import './admin-rich-a.css';

const DAY_MS = 24 * 3600 * 1000;
const FEED_LIMIT = 100;

/**
 * Pull a `total_events` number out of the opaque summary blob.
 * Rust shape today is `{ total_events: i64, by_type: Map<String, i64>, ... }`
 * but we never assume — fall through gracefully if the shape changes.
 */
function readTotal(summary: AnalyticsSummary | null): number {
  if (!summary) return 0;
  const v = (summary as Record<string, unknown>).total_events;
  return typeof v === 'number' ? v : 0;
}

/** Extract by-type counts sorted descending; cap at N. */
function readByType(summary: AnalyticsSummary | null, cap: number): Array<[string, number]> {
  if (!summary) return [];
  const v = (summary as Record<string, unknown>).by_type;
  if (!v || typeof v !== 'object') return [];
  const entries = Object.entries(v as Record<string, unknown>)
    .map(([k, count]) => [k, typeof count === 'number' ? count : 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap);
  return entries;
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function Analytics() {
  const toast = useToast();

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Track-event form
  const [trackType, setTrackType] = useState('');
  const [trackMetadata, setTrackMetadata] = useState('');
  const [trackBusy, setTrackBusy] = useState(false);

  // Prune dialog
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneDays, setPruneDays] = useState('30');
  const [pruneBusy, setPruneBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      dbAnalyticsSummary(),
      dbEventsSince(Date.now() - DAY_MS),
    ]);
    if (results[0].status === 'fulfilled') setSummary(results[0].value);
    if (results[1].status === 'fulfilled') setEvents(results[1].value.slice(0, FEED_LIMIT));

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some analytics data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const totalEvents = readTotal(summary);
  const topTypes = useMemo(() => readByType(summary, 4), [summary]);

  const handleTrack = useCallback(async () => {
    if (trackBusy) return;
    const type = trackType.trim();
    if (!type) return;
    // Metadata is optional; empty string -> undefined.
    let metadata: string | undefined;
    if (trackMetadata.trim().length > 0) {
      // Validate JSON client-side so the user sees errors up-front; we store
      // a stringified JSON value (Rust expects Option<String> metadata blob).
      try {
        JSON.parse(trackMetadata);
        metadata = trackMetadata;
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Invalid metadata JSON',
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }
    setTrackBusy(true);
    try {
      await dbTrackEvent({ eventType: type, metadata });
      toast.show({ type: 'success', title: 'Event tracked', message: type });
      setTrackType('');
      setTrackMetadata('');
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Track failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTrackBusy(false);
    }
  }, [trackBusy, trackType, trackMetadata, toast, loadAll]);

  const handlePrune = useCallback(async () => {
    if (pruneBusy) return;
    const days = Number(pruneDays);
    if (!Number.isFinite(days) || days < 1) return;
    setPruneBusy(true);
    try {
      const removed = await dbPruneAnalytics(days);
      toast.show({
        type: 'success',
        title: 'Analytics pruned',
        message: `${removed} event${removed === 1 ? '' : 's'} older than ${days} day${days === 1 ? '' : 's'} removed`,
      });
      setPruneOpen(false);
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Prune failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPruneBusy(false);
    }
  }, [pruneBusy, pruneDays, toast, loadAll]);

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="analytics-root">
      <div className="admin-header">
        <div>
          <h2 className="admin-header-title">Analytics</h2>
          <div className="admin-header-meta">
            {loading ? 'Loading…' : `${totalEvents} total events · feed last 24h`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadAll()}
            disabled={loading}
            data-testid="analytics-refresh"
          >
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPruneOpen(true)}
            data-testid="analytics-prune-button"
          >
            Prune…
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading analytics" />
        </div>
      ) : (
        <>
          {/* Panel 1 — Hero KPI row */}
          <div className="admin-kpi-grid" data-testid="analytics-kpi">
            <div className="analytics-kpi" data-testid="analytics-kpi-total">
              <span className="analytics-kpi-label">Total events</span>
              <span className="analytics-kpi-value">{totalEvents.toLocaleString()}</span>
              <span className="analytics-kpi-hint">all-time</span>
            </div>
            {topTypes.length === 0 ? (
              <div className="analytics-kpi">
                <span className="analytics-kpi-label">Top types</span>
                <span className="analytics-kpi-value">—</span>
                <span className="analytics-kpi-hint">no data</span>
              </div>
            ) : (
              topTypes.map(([type, count]) => (
                <div key={type} className="analytics-kpi" data-testid="analytics-kpi-type">
                  <span className="analytics-kpi-label">{type}</span>
                  <span className="analytics-kpi-value">{count.toLocaleString()}</span>
                  <span className="analytics-kpi-hint">events</span>
                </div>
              ))
            )}
          </div>

          {/* Panel 2 — Events feed */}
          <div className="admin-section">
            <h3 className="admin-section-title">Events feed</h3>
            <p className="admin-section-subtitle">
              Last 24 hours · {events.length} event{events.length === 1 ? '' : 's'}
            </p>
            {events.length === 0 ? (
              <EmptyState
                label="BLADE is still warming up"
                description="Events will appear after BLADE tracks activity — give me 24h."
              />
            ) : (
              <div className="analytics-events-feed" data-testid="analytics-events-feed">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="analytics-event-row"
                    data-testid="analytics-event-row"
                  >
                    <span className="analytics-event-ts">{formatTs(ev.timestamp)}</span>
                    <span className="analytics-event-type">{ev.event_type}</span>
                    <span className="analytics-event-payload">
                      {ev.metadata ? truncate(ev.metadata, 100) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel 3 — Track event debug form */}
          <div className="admin-section">
            <h3 className="admin-section-title">Track event (debug)</h3>
            <form
              className="analytics-track-form"
              data-testid="analytics-track-form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleTrack();
              }}
            >
              <div className="analytics-track-form-field">
                <label htmlFor="analytics-track-type">Event type</label>
                <Input
                  id="analytics-track-type"
                  type="text"
                  value={trackType}
                  onChange={(e) => setTrackType(e.target.value)}
                  placeholder="e.g. dev_debug_event"
                  disabled={trackBusy}
                />
              </div>
              <div className="analytics-track-form-field" style={{ flex: '2 1 320px' }}>
                <label htmlFor="analytics-track-metadata">Metadata JSON (optional)</label>
                <Input
                  id="analytics-track-metadata"
                  type="text"
                  mono
                  value={trackMetadata}
                  onChange={(e) => setTrackMetadata(e.target.value)}
                  placeholder='{"key":"value"}'
                  disabled={trackBusy}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={trackBusy || trackType.trim().length === 0}
              >
                {trackBusy ? 'Tracking…' : 'Track'}
              </Button>
            </form>
          </div>
        </>
      )}

      {/* ─── Prune dialog ──────────────────────────────────────────── */}
      <Dialog
        open={pruneOpen}
        onClose={() => {
          if (!pruneBusy) setPruneOpen(false);
        }}
        ariaLabel="Prune analytics older than N days"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handlePrune();
          }}
        >
          <h3 className="admin-dialog-heading">Prune analytics</h3>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: 0 }}>
            Permanently deletes every analytics event with a timestamp older than the threshold.
            This cannot be undone.
          </p>
          <div className="admin-dialog-field">
            <label htmlFor="analytics-prune-days">Older than (days)</label>
            <Input
              id="analytics-prune-days"
              type="number"
              min="1"
              step="1"
              mono
              value={pruneDays}
              onChange={(e) => setPruneDays(e.target.value)}
              disabled={pruneBusy}
              autoFocus
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPruneOpen(false)}
              disabled={pruneBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pruneBusy || !Number.isFinite(Number(pruneDays)) || Number(pruneDays) < 1}
            >
              {pruneBusy ? 'Pruning…' : `Prune ${pruneDays}d+`}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassPanel>
  );
}
