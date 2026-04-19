// src/features/life-os/MeetingsView.tsx — Plan 06-03 Task 3 (LIFE-05).
//
// Real body per D-148 — two-column meetings surface with sidebar list
// (meeting_list) + search (meeting_search) + top actions (compare /
// recurring themes) + right pane MeetingDetail sub-component.
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 3
// @see src/features/life-os/MeetingDetail.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, EmptyState, Input, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  meetingList,
  meetingSearch,
  meetingCompare,
  meetingRecurringThemes,
} from '@/lib/tauri/life_os';
import type { Meeting } from './types';
import { MeetingDetail } from './MeetingDetail';
import './life-os.css';
import './life-os-rich-a.css';

export function MeetingsView() {
  const toast = useToast();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Search state — when results are active, sidebar shows them instead of the
  // full list.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Meeting[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  // Compare dialog
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareOutput, setCompareOutput] = useState<string | null>(null);

  // Recurring themes dialog
  const [themesOpen, setThemesOpen] = useState(false);
  const [themes, setThemes] = useState<string[]>([]);
  const [themesBusy, setThemesBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await meetingList(50);
      setMeetings(rows);
      setSelectedId((prev) => prev ?? (rows[0]?.id ?? null));
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Could not load meetings',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleMeetings = useMemo(
    () => searchResults ?? meetings,
    [searchResults, meetings],
  );

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || searchBusy) return;
    setSearchBusy(true);
    try {
      const results = await meetingSearch(q);
      setSearchResults(results);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Search failed',
        message: err instanceof Error ? err.message : String(err),
      });
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  }, [searchQuery, searchBusy, toast]);

  const handleClearSearch = useCallback(() => {
    setSearchResults(null);
    setSearchQuery('');
  }, []);

  const openCompare = useCallback(() => {
    setCompareOpen(true);
    setCompareIds([]);
    setCompareOutput(null);
  }, []);

  const toggleCompareId = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev; // cap at 5 for sanity
      return [...prev, id];
    });
  }, []);

  const handleCompare = useCallback(async () => {
    if (compareIds.length < 2 || compareBusy) return;
    setCompareBusy(true);
    try {
      const result = await meetingCompare(compareIds);
      setCompareOutput(result);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Compare failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCompareBusy(false);
    }
  }, [compareIds, compareBusy, toast]);

  const openThemes = useCallback(async () => {
    setThemesOpen(true);
    setThemes([]);
    setThemesBusy(true);
    try {
      const rows = await meetingRecurringThemes(90);
      setThemes(rows);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Themes failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setThemesBusy(false);
    }
  }, [toast]);

  const handleDeleted = useCallback((id: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    setSelectedId(null);
  }, []);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="meetings-view-root">
      <div className="health-header">
        <div>
          <h2 className="health-header-title">Meetings</h2>
          <div className="health-header-date">
            {meetings.length} recent · {searchResults ? `${searchResults.length} matches` : 'browsing all'}
          </div>
        </div>
      </div>

      <div className="meetings-layout">
        <aside className="meetings-sidebar" aria-label="Meetings list">
          <div className="meetings-sidebar-actions">
            <Button variant="secondary" size="sm" onClick={openCompare}>
              Compare
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openThemes()}>
              Recurring themes
            </Button>
          </div>
          <form
            className="meetings-sidebar-search"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSearch();
            }}
          >
            <Input
              type="search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={searchBusy}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!searchQuery.trim() || searchBusy}
            >
              {searchBusy ? '…' : 'Go'}
            </Button>
            {searchResults ? (
              <Button type="button" variant="ghost" size="sm" onClick={handleClearSearch}>
                Clear
              </Button>
            ) : null}
          </form>

          <div className="meetings-sidebar-list">
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-4)' }}>
                <GlassSpinner size={20} label="Loading meetings" />
              </div>
            ) : visibleMeetings.length === 0 ? (
              <EmptyState
                label="No meetings"
                description="Upcoming meetings will appear here."
              />
            ) : (
              visibleMeetings.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="meeting-sidebar-row"
                  data-testid="meeting-sidebar-row"
                  data-selected={m.id === selectedId}
                  onClick={() => setSelectedId(m.id)}
                >
                  <div className="meeting-sidebar-row-title">{m.title || '(untitled)'}</div>
                  <div className="meeting-sidebar-row-meta">
                    {m.date}
                    {m.duration_minutes ? ` · ${m.duration_minutes}m` : ''}
                    {m.participants && m.participants.length > 0
                      ? ` · ${m.participants.length}👤`
                      : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <MeetingDetail meetingId={selectedId} onDeleted={handleDeleted} />
      </div>

      {/* ─── Compare dialog ──────────────────────────────────────── */}
      <Dialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        ariaLabel="Compare meetings"
      >
        <div className="life-dialog-body" style={{ minWidth: 520 }}>
          <h3 className="life-dialog-heading">Compare meetings</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            Pick 2 or more meetings to compare. Currently selected:{' '}
            <strong>{compareIds.length}</strong>
          </p>
          <div
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              padding: 'var(--s-1)',
            }}
          >
            {meetings.length === 0 ? (
              <div className="life-empty">No meetings available.</div>
            ) : (
              meetings.map((m) => {
                const picked = compareIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="meeting-sidebar-row"
                    data-selected={picked}
                    onClick={() => toggleCompareId(m.id)}
                  >
                    <div className="meeting-sidebar-row-title">
                      {picked ? '✓ ' : ''}
                      {m.title}
                    </div>
                    <div className="meeting-sidebar-row-meta">{m.date}</div>
                  </button>
                );
              })
            )}
          </div>
          {compareOutput ? (
            <pre className="meeting-compose-pre">{compareOutput}</pre>
          ) : null}
          <div className="life-dialog-actions">
            <Button variant="ghost" size="sm" onClick={() => setCompareOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCompare()}
              disabled={compareIds.length < 2 || compareBusy}
            >
              {compareBusy ? 'Comparing…' : compareOutput ? 'Re-compare' : 'Compare'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── Recurring themes dialog ─────────────────────────────── */}
      <Dialog
        open={themesOpen}
        onClose={() => setThemesOpen(false)}
        ariaLabel="Recurring meeting themes"
      >
        <div className="life-dialog-body" style={{ minWidth: 420 }}>
          <h3 className="life-dialog-heading">Recurring themes · last 90 days</h3>
          {themesBusy ? (
            <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <GlassSpinner size={18} label="Analyzing" />
              <span style={{ color: 'var(--t-3)', fontSize: 13 }}>Analyzing…</span>
            </div>
          ) : themes.length === 0 ? (
            <div className="life-empty">No recurring themes detected.</div>
          ) : (
            <ul style={{ color: 'var(--t-2)', fontSize: 13, lineHeight: 1.6 }}>
              {themes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          <div className="life-dialog-actions">
            <Button variant="primary" size="sm" onClick={() => setThemesOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
