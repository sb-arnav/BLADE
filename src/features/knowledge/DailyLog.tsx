// src/features/knowledge/DailyLog.tsx — Phase 5 Plan 05-06 (KNOW-07).
//
// Day-grouped memory log. Pulls the last 500 memory_get_recent rows and
// groups them client-side by calendar date. Most-recent day is expanded by
// default; older days collapse to a count header with click-to-expand.
//
// Rust side writes `created_at` as unix SECONDS (memory_palace.rs). A defensive
// detector converts to ms if the first entry looks like milliseconds instead
// (> 1e12), covering any future unit drift.
//
// @see .planning/phases/05-agents-knowledge/05-06-PLAN.md
// @see src-tauri/src/memory_palace.rs:796 memory_get_recent
// @see .planning/REQUIREMENTS.md §KNOW-07

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { memoryGetRecent } from '@/lib/tauri/knowledge';
import type { MemoryEpisode } from '@/lib/tauri/knowledge';
import './knowledge.css';
import './knowledge-rich-b.css';

const LOG_LIMIT = 500;

interface DayGroup {
  key: string; // ISO date, YYYY-MM-DD
  label: string;
  entries: MemoryEpisode[];
}

function toMs(unix: number): number {
  if (!Number.isFinite(unix)) return 0;
  return unix > 1e12 ? unix : unix * 1000;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayMid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((todayMid - dayMid) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupByDay(entries: MemoryEpisode[]): DayGroup[] {
  const groups = new Map<string, { label: string; entries: MemoryEpisode[]; sortKey: number }>();
  for (const entry of entries) {
    const ms = toMs(entry.created_at);
    const key = dayKey(ms);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, { label: dayLabel(ms), entries: [entry], sortKey: ms });
    }
  }
  // Sort entries within each group newest-first; groups newest-first.
  const out: DayGroup[] = Array.from(groups.entries()).map(([key, g]) => ({
    key,
    label: g.label,
    entries: [...g.entries].sort(
      (a, b) => toMs(b.created_at) - toMs(a.created_at),
    ),
  }));
  out.sort((a, b) => {
    const am = a.entries[0] ? toMs(a.entries[0].created_at) : 0;
    const bm = b.entries[0] ? toMs(b.entries[0].created_at) : 0;
    return bm - am;
  });
  return out;
}

export function DailyLog() {
  const [rows, setRows] = useState<MemoryEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const recent = await memoryGetRecent({ limit: LOG_LIMIT });
      setRows(recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupByDay(rows), [rows]);

  // Default-expand the most recent day only.
  useEffect(() => {
    if (groups.length === 0) return;
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [groups[0].key]: true };
    });
  }, [groups]);

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="daily-log-root">
      <div className="kb-section-heading">
        <h2 className="kb-section-title">Daily Log</h2>
        <span className="memory-palace-entry-meta">
          {loading ? 'Loading…' : `${rows.length} entries · ${groups.length} days`}
        </span>
      </div>

      {error ? (
        <div className="daily-log-empty" role="alert">
          Could not load memories: {error}
        </div>
      ) : groups.length === 0 && !loading ? (
        <div className="daily-log-empty">No memories in the log yet.</div>
      ) : (
        <div className="daily-log-layout">
          {groups.map((group) => {
            const isOpen = expanded[group.key] === true;
            return (
              <section key={group.key} className="daily-log-day">
                <button
                  type="button"
                  className="daily-log-day-heading"
                  data-expanded={isOpen ? 'true' : 'false'}
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [group.key]: !isOpen }))
                  }
                  aria-expanded={isOpen}
                >
                  <span className="daily-log-day-label">{group.label}</span>
                  <span className="daily-log-day-count">
                    {group.entries.length} · {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <div className="daily-log-day-entries">
                    {group.entries.map((entry) => (
                      <div key={entry.id} className="daily-log-entry">
                        <span className="daily-log-entry-time">
                          {formatTime(toMs(entry.created_at))}
                        </span>
                        <span className="daily-log-entry-kind">
                          <span className="topic-pill">
                            {entry.episode_type || 'memory'}
                          </span>
                        </span>
                        <span className="daily-log-entry-body">
                          <strong>{entry.title || '(untitled)'}</strong>
                          {entry.summary && entry.summary !== entry.title ? (
                            <>
                              {' — '}
                              {entry.summary}
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
