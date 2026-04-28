// src/features/dashboard/CalendarCard.tsx — Phase 14 Plan 14-03 (WIRE2-02)
//
// Live "Calendar" dashboard card — replaces the ComingSoonCard placeholder.
// Fetches today's events via calendarGetToday() on mount; silently handles
// errors (calendar tentacle may be disabled).
// Empty state has a CTA — not a dead placeholder.
//
// @see src-tauri/src/tentacles/calendar_tentacle.rs
// @see src/lib/tauri/intelligence.ts

import { useEffect, useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { calendarGetToday } from '@/lib/tauri/intelligence';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { CalendarEvent } from '@/lib/tauri/intelligence';

function formatTimeRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return iso;
    }
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function CalendarCard() {
  const { openRoute } = useRouterCtx();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    calendarGetToday()
      .then(setEvents)
      .catch(() => { /* calendar tentacle may be disabled — degrade gracefully */ })
      .finally(() => setLoading(false));
  }, []);

  const displayed = events.slice(0, 4);

  return (
    <GlassPanel
      tier={2}
      className="dash-card"
      role="region"
      aria-label={`Calendar — ${events.length} events today`}
    >
      <header className="dash-card-head">
        <h3 className="dash-card-title t-h3">Calendar</h3>
      </header>

      {loading && (
        <div aria-busy="true" aria-label="Loading calendar events">
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', marginBottom: 'var(--s-2)' }} />
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', width: '70%' }} />
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="t-small dash-card-empty" style={{ color: 'var(--t-3)' }}>
          Calendar not connected. Enable monitoring in Ecosystem settings.{' '}
          <button
            className="dash-card-cta"
            aria-label="Open Ecosystem settings to connect calendar"
            onClick={() => openRoute('settings-ecosystem')}
          >
            Open settings
          </button>
        </p>
      )}

      {!loading && events.length > 0 && (
        <ul className="dash-card-list" aria-label="Today's events" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {displayed.map((ev) => (
            <li key={ev.id} style={{ marginBottom: 'var(--s-2)' }}>
              <div className="t-small" style={{ color: 'var(--t-3)', fontSize: 11 }}>
                {formatTimeRange(ev.start, ev.end)}
              </div>
              <div className="t-small" style={{ color: 'var(--t-1)' }}>
                {truncate(ev.title, 50)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
