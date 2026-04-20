// src/features/identity/ProfileView.tsx — Phase 12 Plan 12-04 (SCAN-10/11/12/13 UI)
//
// ProfileView is the 8th identity sub-view. It renders the structured profile
// produced by Plan 12-03's overlay backend (profile_get_rendered) across 5 tabs:
// Repos / Accounts / Stack / Rhythm / Files.
//
// Sub-components (all co-located here per D-63 no-new-file rule):
//   SourcePill      — scanner-origin pill with taxonomy colors (UI-SPEC §Source Pill Taxonomy)
//   ScanActivityTail — live-tail panel (Surface B, D-64)
//   ProfileSectionTable — shared semantic table for Repos/Accounts/Files
//   LeadDetailsDrawer — right-edge drawer for row details
//   RhythmHeatmap   — 7×24 CSS Grid (hour-of-day × day-of-week)
//
// @see .planning/phases/12-smart-deep-scan/12-UI-SPEC.md
// @see .planning/phases/12-smart-deep-scan/12-CONTEXT.md §D-63, §D-64
// @see src/lib/tauri/deepscan.ts (profileGetRendered, profileOverlayUpsert, etc.)

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  GlassPanel,
  GlassSpinner,
  ListSkeleton,
  Pill,
} from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import {
  BLADE_EVENTS,
  useTauriEvent,
} from '@/lib/events';
import type { DeepScanProgressPayload } from '@/lib/events';
import {
  deepScanStart,
  profileGetRendered,
  profileOverlayReset,
  profileOverlayUpsert,
  scanCancel,
} from '@/lib/tauri/deepscan';
import type { OverlayAction, ProfileView as ProfileData, RenderedRow, RhythmSignal } from '@/types/provider';
import { EditSectionDialog } from './EditSectionDialog';
import './identity.css';

// ---------------------------------------------------------------------------
// Source Pill Taxonomy (UI-SPEC §Source Pill Taxonomy — locked colors)
// ---------------------------------------------------------------------------

const SOURCE_PILL_MAP: Record<string, { label: string; color: string; borderColor: string; bg: string }> = {
  fs_repos:      { label: 'fs',     color: 'var(--a-warm)', borderColor: 'rgba(255,210,166,0.3)', bg: 'var(--g-fill)' },
  fs:            { label: 'fs',     color: 'var(--a-warm)', borderColor: 'rgba(255,210,166,0.3)', bg: 'var(--g-fill)' },
  git_remotes:   { label: 'git',    color: 'var(--a-cool)', borderColor: 'rgba(200,224,255,0.3)', bg: 'var(--g-fill)' },
  git:           { label: 'git',    color: 'var(--a-cool)', borderColor: 'rgba(200,224,255,0.3)', bg: 'var(--g-fill)' },
  ide_workspaces:{ label: 'ide',    color: 'var(--a-ok)',   borderColor: 'rgba(138,255,199,0.3)', bg: 'var(--g-fill)' },
  ide:           { label: 'ide',    color: 'var(--a-ok)',   borderColor: 'rgba(138,255,199,0.3)', bg: 'var(--g-fill)' },
  ai_sessions:   { label: 'ai',     color: 'var(--a-ok)',   borderColor: 'rgba(138,255,199,0.3)', bg: 'var(--g-fill)' },
  ai:            { label: 'ai',     color: 'var(--a-ok)',   borderColor: 'rgba(138,255,199,0.3)', bg: 'var(--g-fill)' },
  shell_history: { label: 'shell',  color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  shell:         { label: 'shell',  color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  mru:           { label: 'mru',    color: 'var(--a-warm)', borderColor: 'rgba(255,210,166,0.3)', bg: 'var(--g-fill)' },
  bookmarks:     { label: 'bkmk',   color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  bkmk:          { label: 'bkmk',   color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  which_sweep:   { label: 'which',  color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  which:         { label: 'which',  color: 'var(--t-2)',    borderColor: 'var(--g-edge-mid)',      bg: 'var(--g-fill)' },
  user:          { label: 'manual', color: 'var(--t-3)',    borderColor: 'var(--g-edge-lo)',       bg: 'var(--g-fill-weak)' },
  manual:        { label: 'manual', color: 'var(--t-3)',    borderColor: 'var(--g-edge-lo)',       bg: 'var(--g-fill-weak)' },
};

interface SourcePillProps {
  scanner: string;
  leadPath?: string;
}

function SourcePill({ scanner, leadPath }: SourcePillProps) {
  const token = SOURCE_PILL_MAP[scanner] ?? SOURCE_PILL_MAP['user'];
  const tooltip = leadPath
    ? `Found by ${scanner} at ${leadPath}`
    : `Found by ${scanner}`;
  return (
    <Pill
      style={{ color: token.color, borderColor: token.borderColor, background: token.bg }}
      title={tooltip}
    >
      {token.label}
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// ScanActivityTail — live-tail panel (Surface B, D-64)
// ---------------------------------------------------------------------------

interface LogLine {
  ts: string;
  tag: string;
  msg: string;
  id: string;
}

function nowTs(): string {
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':');
}

interface ScanActivityTailProps {
  onScanComplete?: () => void;
}

function ScanActivityTail({ onScanComplete }: ScanActivityTailProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [initialQueueDepth, setInitialQueueDepth] = useState<number | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [foundCount, setFoundCount] = useState<number>(0);
  const [lastScanRelative, setLastScanRelative] = useState<string | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineCounterRef = useRef(0);
  const logBodyRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const handleProgress = useCallback((e: { payload: DeepScanProgressPayload }) => {
    const p = e.payload as DeepScanProgressPayload & {
      lead_kind?: string;
      lead_seed?: string;
      priority_tier?: string;
      queue_depth?: number;
      elapsed_ms?: number;
      message?: string;
    };

    if (!scanning) setScanning(true);
    if (!expanded) setExpanded(true);

    // Clear pending auto-collapse
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }

    setFoundCount(p.found ?? 0);
    if (p.priority_tier) setTier(p.priority_tier);
    if (p.queue_depth !== undefined && p.queue_depth !== null) {
      setQueueDepth(p.queue_depth);
      setInitialQueueDepth((prev) => prev ?? p.queue_depth!);
    }

    const tag = p.phase || p.lead_kind || 'scan';
    const msg = p.message || `${p.phase}: +${p.found} rows`;

    const newLine: LogLine = {
      ts: nowTs(),
      tag,
      msg,
      id: String(lineCounterRef.current++),
    };
    setLines((prev) => [...prev.slice(-9), newLine]);

    // Check for scan completion
    if (p.phase === 'complete') {
      setScanning(false);
      setLastScanRelative('just now');
      onScanComplete?.();
      collapseTimerRef.current = setTimeout(() => {
        setExpanded(false);
        setQueueDepth(null);
        setInitialQueueDepth(null);
        setTier(null);
      }, 3000);
    }
  }, [scanning, expanded, onScanComplete]);

  useTauriEvent(BLADE_EVENTS.DEEP_SCAN_PROGRESS, handleProgress as Parameters<typeof useTauriEvent>[1]);

  // Scroll log to bottom unless user scrolled up
  useEffect(() => {
    if (!userScrolled && logBodyRef.current && expanded) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [lines, expanded, userScrolled]);

  const handleLogScroll = () => {
    if (!logBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logBodyRef.current;
    setUserScrolled(scrollHeight - scrollTop - clientHeight > 10);
  };

  const handleCancel = async () => {
    try {
      await scanCancel();
    } catch {
      // ignore
    }
  };

  const summaryText = scanning
    ? `(${queueDepth ?? '?'} / ${initialQueueDepth ?? '?'}) ${tier ?? ''} queue draining`
    : lastScanRelative
    ? `Last scan ${lastScanRelative} — ${foundCount} rows`
    : 'Never scanned';

  return (
    <GlassPanel tier={2} style={{ padding: expanded ? 'var(--s-4)' : 'var(--s-3)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <button
          aria-expanded={expanded}
          aria-controls="scan-log-body"
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-2)', display: 'flex', alignItems: 'center', gap: 'var(--s-1)', padding: 0 }}
        >
          <span style={{ fontSize: 14 }}>{expanded ? '▼' : '▸'}</span>
          <span className="t-h3" style={{ fontSize: 18, fontWeight: 600 }}>Activity</span>
        </button>
        <span
          className="t-small"
          style={{ color: scanning ? 'var(--t-1)' : 'var(--t-2)', flex: 1, marginLeft: 'var(--s-2)' }}
        >
          {summaryText}
        </span>
        {scanning && (
          <Button
            variant="secondary"
            size="sm"
            aria-label="Cancel scan"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        )}
      </div>

      {expanded && (
        <div
          id="scan-log-body"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          ref={logBodyRef}
          className="scan-log-body"
          style={{ marginTop: 'var(--s-2)' }}
          onScroll={handleLogScroll}
        >
          {lines.length === 0 && (
            <div className="scan-log-line" style={{ color: 'var(--t-3)' }}>
              Waiting for scan events…
            </div>
          )}
          {lines.map((line) => (
            <div
              key={line.id}
              role="listitem"
              className="scan-log-line list-entrance"
            >
              <span className="scan-log-ts">{line.ts}</span>
              <span className={`scan-log-tag-${line.tag.replace(/\s+/g, '_')}`}>{line.tag}</span>
              <span className="scan-log-msg" title={line.msg}>{line.msg}</span>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// ProfileSectionTable — shared table for Repos / Accounts / Files
// ---------------------------------------------------------------------------

interface ColDef {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render?: (row: RenderedRow) => React.ReactNode;
}

interface RowMenuState {
  rowId: string;
  open: boolean;
}

interface ProfileSectionTableProps {
  rows: RenderedRow[];
  columns: ColDef[];
  sectionLabel: string;
  onRowClick: (row: RenderedRow) => void;
  onEdit: (row: RenderedRow) => void;
  onHide: (row: RenderedRow) => void;
  onDelete: (row: RenderedRow) => void;
  onReset: (row: RenderedRow) => void;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

function ProfileSectionTable({
  rows,
  columns,
  sectionLabel,
  onRowClick,
  onEdit,
  onHide,
  onDelete,
  onReset,
  sortBy,
  sortDir,
  onSort,
}: ProfileSectionTableProps) {
  const [menuState, setMenuState] = useState<RowMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState(null);
      }
    };
    if (menuState?.open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuState]);

  const getRowLabel = (row: RenderedRow): string => {
    const f = row.fields;
    if (row.row_kind === 'repo') return String(f.path ?? f.remote ?? row.row_id);
    if (row.row_kind === 'account') return `${f.platform ?? ''}:${f.handle ?? ''}`;
    if (row.row_kind === 'mru_file') return String(f.path ?? row.row_id);
    return row.row_id;
  };

  return (
    <GlassPanel tier={2} style={{ borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <table
        role="table"
        aria-label={`${sectionLabel} rows`}
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{
                  padding: 'var(--s-2) var(--s-3)',
                  textAlign: col.align ?? 'left',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--t-3)',
                  borderBottom: '1px solid var(--line)',
                  cursor: col.sortable ? 'pointer' : 'default',
                  userSelect: col.sortable ? 'none' : 'auto',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => col.sortable && onSort(col.key)}
              >
                {col.label}
                {col.sortable && sortBy === col.key && (
                  <span style={{ marginLeft: 4, color: 'var(--t-3)', fontSize: 11 }}>
                    {sortDir === 'asc' ? '▴' : '▾'}
                  </span>
                )}
              </th>
            ))}
            <th scope="col" style={{ width: 40, padding: 'var(--s-2)', borderBottom: '1px solid var(--line)' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rowLabel = getRowLabel(row);
            const isMenuOpen = menuState?.rowId === row.row_id && menuState.open;
            const isEven = i % 2 === 0;
            return (
              <tr
                key={row.row_id}
                className={`profile-table-row${row.orphaned ? ' profile-table-row-orphaned' : ''}`}
                style={{
                  background: isEven ? 'transparent' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  color: row.orphaned ? 'var(--t-3)' : undefined,
                }}
                onClick={() => onRowClick(row)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onRowClick(row); }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: 'var(--s-2) var(--s-3)',
                      borderBottom: '1px solid var(--line)',
                      textAlign: col.align ?? 'left',
                      fontSize: 14,
                      maxWidth: col.key === 'path' ? 240 : undefined,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: col.align === 'right' ? 'tabular-nums' : undefined,
                    }}
                  >
                    {col.render ? col.render(row) : String(row.fields[col.key] ?? '—')}
                  </td>
                ))}
                <td
                  style={{ padding: 'var(--s-2)', borderBottom: '1px solid var(--line)', position: 'relative' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="icon"
                    size="sm"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    aria-label={`Actions for ${rowLabel}`}
                    onClick={() => setMenuState(isMenuOpen ? null : { rowId: row.row_id, open: true })}
                  >
                    ⋮
                  </Button>
                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      role="menu"
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '100%',
                        zIndex: 100,
                        background: 'var(--g-fill-strong)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)',
                        padding: 'var(--s-1)',
                        minWidth: 140,
                      }}
                    >
                      {!row.orphaned && (
                        <>
                          <button
                            role="menuitem"
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s-1) var(--s-2)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-1)', fontSize: 14, borderRadius: 'var(--r-sm)' }}
                            onClick={() => { setMenuState(null); onEdit(row); }}
                          >
                            Edit…
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s-1) var(--s-2)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-1)', fontSize: 14, borderRadius: 'var(--r-sm)' }}
                            onClick={() => { setMenuState(null); onHide(row); }}
                          >
                            Hide row
                          </button>
                        </>
                      )}
                      <button
                        role="menuitem"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s-1) var(--s-2)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-error, #ff6b6b)', fontSize: 14, borderRadius: 'var(--r-sm)' }}
                        onClick={() => { setMenuState(null); onDelete(row); }}
                      >
                        Delete
                      </button>
                      {row.edited && (
                        <button
                          role="menuitem"
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s-1) var(--s-2)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-1)', fontSize: 14, borderRadius: 'var(--r-sm)' }}
                          onClick={() => { setMenuState(null); onReset(row); }}
                        >
                          Reset to scan
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// LeadDetailsDrawer — right-edge slide-in drawer
// ---------------------------------------------------------------------------

interface LeadDetailsDrawerProps {
  row: RenderedRow | null;
  onClose: () => void;
}

function LeadDetailsDrawer({ row, onClose }: LeadDetailsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    if (!row) return;
    drawerRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [row, onClose]);

  if (!row) return null;

  const primaryLabel = String(row.fields.path ?? row.fields.handle ?? row.row_id);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.3)',
        }}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-heading"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 60vw)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <GlassPanel tier={2} style={{ height: '100%', borderRadius: '0', borderLeft: '1px solid var(--line)', padding: 'var(--s-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 id="drawer-heading" style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--t-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {primaryLabel}
            </h3>
            <Button variant="icon" size="sm" onClick={onClose} aria-label="Close drawer">×</Button>
          </div>

          <div>
            <p style={{ margin: '0 0 var(--s-2)', fontSize: 13, fontWeight: 600, color: 'var(--t-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Discovered via
            </p>
            {row.orphaned ? (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--t-3)' }}>
                No longer found in latest scan — this row is preserved from your manual edits.
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--t-2)' }}>
                <SourcePill scanner={row.source_scanner} /> {row.source_scanner}
              </p>
            )}
          </div>

          <div>
            <p style={{ margin: '0 0 var(--s-2)', fontSize: 13, fontWeight: 600, color: 'var(--t-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Follow-ups produced
            </p>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--t-2)' }}>
              {row.fields.follow_ups
                ? String(row.fields.follow_ups)
                : <span style={{ color: 'var(--t-3)' }}>None recorded</span>}
            </p>
          </div>

          {row.edited && (
            <div>
              <p style={{ margin: '0 0 var(--s-2)', fontSize: 13, fontWeight: 600, color: 'var(--t-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Overlay state
              </p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--t-2)' }}>
                <Pill tone="pro">edited</Pill> {row.fields.edited_at ? `Edited at ${row.fields.edited_at}` : 'Field values overridden by your edit.'}
              </p>
            </div>
          )}

          <div>
            <p style={{ margin: '0 0 var(--s-2)', fontSize: 13, fontWeight: 600, color: 'var(--t-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Fields
            </p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-2)', lineHeight: 1.6 }}>
              {Object.entries(row.fields).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: 'var(--t-3)' }}>{k}:</span>{' '}
                  <span>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// RhythmHeatmap — 7×24 CSS Grid
// ---------------------------------------------------------------------------

interface RhythmHeatmapProps {
  hourData: number[][];  // 7 days × 24 hours
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = ['0', '6', '12', '18'];

function RhythmHeatmap({ hourData }: RhythmHeatmapProps) {
  const maxCount = Math.max(1, ...hourData.flat());
  let totalSignals = 0;
  let peakHour = 0;
  let peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = hourData[d]?.[h] ?? 0;
      totalSignals += v;
      if (v > peakVal) { peakVal = v; peakHour = h; }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-2)' }}>
        {/* Y-axis labels */}
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 20px)', gap: '2px', paddingTop: 2 }}>
          {DAY_LABELS.map((d) => (
            <div key={d} style={{ fontSize: 11, color: 'var(--t-3)', lineHeight: '20px', whiteSpace: 'nowrap' }}>{d}</div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div
          role="img"
          aria-label={`Activity heatmap, ${totalSignals} signals across 7 days and 24 hours. Peak hour: ${peakHour}:00.`}
          className="rhythm-heatmap"
        >
          {Array.from({ length: 7 }, (_, d) =>
            Array.from({ length: 24 }, (_, h) => {
              const count = hourData[d]?.[h] ?? 0;
              const opacity = count === 0 ? 0.04 : Math.min(0.8, Math.max(0.04, count / maxCount));
              return (
                <div
                  key={`${d}-${h}`}
                  className="rhythm-cell"
                  style={{ background: `rgba(200, 224, 255, ${opacity})` }}
                  title={`${DAY_LABELS[d]} ${h}:00 — ${count} signals`}
                />
              );
            })
          )}
        </div>
      </div>

      {/* X-axis */}
      <div style={{ display: 'flex', marginLeft: 34, gap: 0, marginTop: 4 }}>
        {HOUR_LABELS.map((lbl) => (
          <div key={lbl} style={{ width: `${(parseInt(lbl) === 0 ? 0 : parseInt(lbl)) / 24 * 24 * 22}px`, fontSize: 10, color: 'var(--t-3)', paddingLeft: lbl === '0' ? 0 : undefined }}>
            {lbl === '0' ? '0' : lbl}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(unixSeconds: number | null): string {
  if (!unixSeconds) return 'unknown';
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function humanFileSize(bytes: unknown): string {
  const n = typeof bytes === 'number' ? bytes : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseFieldsFromText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

function fieldsToText(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}: ${v ?? ''}`)
    .join('\n');
}

// Build heatmap data from rhythm signals
function buildHourData(rhythmSignals: RhythmSignal[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const sig of rhythmSignals) {
    if (sig.kind === 'hour_of_day_histogram') {
      const data = sig.data as { hour: number; count: number }[] | undefined;
      if (Array.isArray(data)) {
        for (const { hour, count } of data) {
          for (let d = 0; d < 7; d++) {
            grid[d][hour] = Math.max(grid[d][hour], count);
          }
        }
      }
    } else if (sig.kind === 'day_of_week_distribution') {
      const data = sig.data as { day: number; count: number }[] | undefined;
      if (Array.isArray(data)) {
        for (const { day, count } of data) {
          if (day >= 0 && day < 7) {
            for (let h = 0; h < 24; h++) {
              grid[day][h] = Math.max(grid[day][h], Math.floor(count / 24));
            }
          }
        }
      }
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// ProfileView — main exported component
// ---------------------------------------------------------------------------

type ProfileTab = 'repos' | 'accounts' | 'stack' | 'rhythm' | 'files';
type MruWindow = '7d' | '30d' | 'all';

export function ProfileView() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('repos');
  const [drawerRow, setDrawerRow] = useState<RenderedRow | null>(null);
  const [editRow, setEditRow] = useState<RenderedRow | null>(null);
  const [mruWindow, setMruWindow] = useState<MruWindow>('7d');
  const [sortBy, setSortBy] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [scanning, setScanning] = useState(false);
  const [srMessage, setSrMessage] = useState('');
  const toast = useToast();
  const { openRoute } = useRouterCtx();

  const loadProfile = useCallback(async () => {
    try {
      const p = await profileGetRendered();
      setProfile(p);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleScanComplete = useCallback(() => {
    setScanning(false);
    setSrMessage(`Scan complete. Found ${profile?.repos?.length ?? 0} repos, ${profile?.accounts?.length ?? 0} accounts.`);
    void loadProfile();
  }, [loadProfile, profile]);

  const handleRescan = async () => {
    if (scanning) return;
    setScanning(true);
    setSrMessage('Deep scan started.');
    try {
      await deepScanStart();
    } catch (e) {
      setScanning(false);
      toast.show({ type: 'error', title: `Couldn't start scan. ${typeof e === 'string' ? e : String(e)}` });
      setSrMessage('');
    }
  };

  const handleSort = (key: string) => {
    setSortDir((prev) => (sortBy === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortBy(key);
  };

  const handleEdit = (row: RenderedRow) => {
    setEditRow(row);
  };

  const handleHide = async (row: RenderedRow) => {
    try {
      await profileOverlayUpsert(row.row_id, 'hide');
      setSrMessage(`Hid ${row.row_id}.`);
      toast.show({ type: 'success', title: `Hid row` });
      await loadProfile();
    } catch (e) {
      toast.show({ type: 'error', title: `Couldn't hide row. ${typeof e === 'string' ? e : String(e)}` });
    }
  };

  const handleDelete = async (row: RenderedRow) => {
    try {
      await profileOverlayUpsert(row.row_id, 'delete');
      setSrMessage(`Deleted ${row.row_id}.`);
      toast.show({ type: 'success', title: `Deleted row` });
      await loadProfile();
    } catch (e) {
      toast.show({ type: 'error', title: `Couldn't save edit. ${typeof e === 'string' ? e : String(e)}` });
    }
  };

  const handleReset = async (row: RenderedRow) => {
    try {
      await profileOverlayReset(row.row_id);
      setSrMessage(`Restored ${row.row_id} to scan value.`);
      toast.show({ type: 'success', title: `Restored row` });
      await loadProfile();
    } catch (e) {
      toast.show({ type: 'error', title: `Couldn't reset row. ${typeof e === 'string' ? e : String(e)}` });
    }
  };

  const handleSaveEdit = async (content: string): Promise<void> => {
    if (!editRow) return;
    const fields = parseFieldsFromText(content);
    await profileOverlayUpsert(editRow.row_id, 'edit' as OverlayAction, fields);
    setSrMessage(`Edited ${editRow.row_id}.`);
    await loadProfile();
  };

  const hasEverScanned = profile && profile.scanned_at != null;
  const scanSummaryText = scanning
    ? 'Scanning…'
    : hasEverScanned
    ? `Last scan: ${relativeTime(profile!.scanned_at)} • ${profile!.repos.length} repos • ${profile!.accounts.length} accounts`
    : "BLADE hasn't scanned yet.";

  const reScanLabel = scanning ? 'Scanning…' : hasEverScanned ? 'Re-scan' : 'Run first scan';

  // Sort helpers
  const sortRows = (rows: RenderedRow[], key: string, dir: 'asc' | 'desc') => {
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const av = String(a.fields[key] ?? '');
      const bv = String(b.fields[key] ?? '');
      const cmp = av.localeCompare(bv);
      return dir === 'asc' ? cmp : -cmp;
    });
  };

  // Filtered MRU
  const filteredMru = (profile?.mru_files ?? []).filter((row) => {
    if (mruWindow === '7d') {
      const mtime = Number(row.fields.mtime_unix ?? 0);
      return mtime > (Date.now() / 1000 - 7 * 86400);
    }
    if (mruWindow === '30d') {
      const mtime = Number(row.fields.mtime_unix ?? 0);
      return mtime > (Date.now() / 1000 - 30 * 86400);
    }
    return true;
  });

  const sortedRepos = sortRows(profile?.repos ?? [], sortBy, sortDir);
  const sortedAccounts = sortRows(profile?.accounts ?? [], sortBy, sortDir);
  const sortedMru = sortRows(filteredMru, sortBy, sortDir);

  // Build language counts for Stack tab
  const langCounts: Record<string, number> = {};
  for (const repo of profile?.repos ?? []) {
    const lang = String(repo.fields.primary_language ?? repo.fields.language ?? '');
    if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1;
  }
  const topLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxLangCount = Math.max(1, topLangs[0]?.[1] ?? 1);

  // Collect tools and ides
  const detectedTools = profile?.tools ?? [];
  const detectedIdes = profile?.ides ?? [];

  // Rhythm data
  const hourData = buildHourData(profile?.rhythm_signals ?? []);
  const rhythmNarrative = profile?.llm_enrichments?.rhythm_narrative;

  // Day-of-week distribution for bar chart
  const dayOfWeekData: number[] = Array(7).fill(0);
  for (const sig of profile?.rhythm_signals ?? []) {
    if (sig.kind === 'day_of_week_distribution') {
      const data = sig.data as { day: number; count: number }[] | undefined;
      if (Array.isArray(data)) {
        for (const { day, count } of data) {
          if (day >= 0 && day < 7) dayOfWeekData[day] = count;
        }
      }
    }
  }
  const maxDayCount = Math.max(1, ...dayOfWeekData);

  const TABS: { id: ProfileTab; label: string; count?: number }[] = [
    { id: 'repos', label: 'Repos', count: profile?.repos.length },
    { id: 'accounts', label: 'Accounts', count: profile?.accounts.length },
    { id: 'stack', label: 'Stack' },
    { id: 'rhythm', label: 'Rhythm' },
    { id: 'files', label: 'Files', count: filteredMru.length },
  ];

  const REPOS_COLS: ColDef[] = [
    { key: 'path', label: 'Path', sortable: true, render: (row) => <span title={String(row.fields.path ?? '')} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{String(row.fields.path ?? '—')}</span> },
    { key: 'remote_url', label: 'Remote', render: (row) => <span style={{ fontSize: 13, color: 'var(--t-2)' }}>{String(row.fields.remote_url ?? row.fields.remote ?? '—')}</span> },
    { key: 'primary_language', label: 'Language', sortable: true },
    { key: 'last_active_days', label: 'Last active', sortable: true, render: (row) => <span>{row.fields.last_active_days != null ? `${row.fields.last_active_days}d` : '—'}</span> },
    {
      key: 'source', label: 'Source',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)' }}>
          <SourcePill scanner={row.source_scanner} />
          {row.edited && <Pill tone="pro">edited</Pill>}
          {row.orphaned && <Pill tone="new">not found</Pill>}
        </span>
      ),
    },
  ];

  const ACCOUNTS_COLS: ColDef[] = [
    { key: 'platform', label: 'Platform', sortable: true },
    { key: 'handle', label: 'Handle', sortable: true },
    {
      key: 'source', label: 'Source',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)' }}>
          <SourcePill scanner={row.source_scanner} />
          {row.edited && <Pill tone="pro">edited</Pill>}
          {row.orphaned && <Pill tone="new">not found</Pill>}
        </span>
      ),
    },
  ];

  const FILES_COLS: ColDef[] = [
    { key: 'path', label: 'Path', sortable: true, render: (row) => <span title={String(row.fields.path ?? '')} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{String(row.fields.path ?? '—')}</span> },
    { key: 'mtime_unix', label: 'Last modified', sortable: true, render: (row) => <span>{relativeTime(Number(row.fields.mtime_unix) || null)}</span> },
    { key: 'size_bytes', label: 'Size', align: 'right' as const, render: (row) => <span>{humanFileSize(row.fields.size_bytes)}</span> },
    { key: 'project_root', label: 'Project root', render: (row) => <span style={{ fontSize: 13, color: 'var(--t-2)' }}>{String(row.fields.project_root ?? '—')}</span> },
    {
      key: 'source', label: 'Source',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)' }}>
          <SourcePill scanner={row.source_scanner} />
          {row.edited && <Pill tone="pro">edited</Pill>}
          {row.orphaned && <Pill tone="new">not found</Pill>}
        </span>
      ),
    },
  ];

  return (
    <section className="identity-surface" aria-labelledby="profile-heading">
      {/* Screen-reader live region */}
      <div className="sr-only" role="status" aria-live="polite">{srMessage}</div>

      <h2 id="profile-heading" className="t-h2">Profile</h2>
      <p className="t-body" style={{ color: 'var(--t-2)', marginBottom: 'var(--s-4)' }}>
        A snapshot of your environment. Every row links back to the scanner that found it. Edit anything — your changes persist.
      </p>

      {/* Scan-summary bar */}
      <div role="status" aria-live="polite" aria-atomic="true" className="scan-summary-bar">
        <Card tier={1} padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
            <span className="t-small" style={{ color: 'var(--t-2)' }}>{scanSummaryText}</span>
            <Button
              variant="secondary"
              size="md"
              onClick={handleRescan}
              disabled={scanning}
              aria-busy={scanning}
            >
              {scanning ? (
                <><GlassSpinner size={12} /> Scanning…</>
              ) : (
                <>{reScanLabel}</>
              )}
            </Button>
          </div>
        </Card>
      </div>

      {/* Live-tail activity panel */}
      <ScanActivityTail onScanComplete={handleScanComplete} />

      {/* Tab nav */}
      <div role="tablist" aria-label="Profile sections" className="identity-tabs">
        {TABS.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            className="identity-tab-pill"
            data-active={String(activeTab === id)}
            onClick={() => setActiveTab(id)}
          >
            {label}{count != null ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {/* Tab panels */}

      {/* Tab 1: Repos */}
      <div
        role="tabpanel"
        id="panel-repos"
        aria-labelledby="tab-repos"
        hidden={activeTab !== 'repos'}
      >
        {loading ? (
          <ListSkeleton rows={5} />
        ) : error ? (
          <EmptyState
            label={`Couldn't load profile. ${error}`}
            actionLabel="Retry"
            onAction={loadProfile}
            testId="profile-error-repos"
          />
        ) : sortedRepos.length === 0 ? (
          hasEverScanned ? (
            <EmptyState
              label="Filesystem repo walk is off"
              description="Enable it in Privacy settings to see repos here."
              actionLabel="Open Privacy settings"
              onAction={() => openRoute('settings-privacy')}
              testId="profile-empty-repos-class-disabled"
            />
          ) : (
            <EmptyState
              label="No profile yet"
              description="Run your first scan to see the repos, accounts, stack, rhythm, and files BLADE found on your machine."
              actionLabel="Run first scan"
              onAction={handleRescan}
              testId="profile-empty-repos-never-scanned"
            />
          )
        ) : (
          <Card tier={1} padding="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-3)' }}>
              <span className="t-h3">Repos ({sortedRepos.length})</span>
              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                <Button variant="ghost" size="sm" onClick={async () => {
                  const fields = { path: '', remote_url: '', primary_language: '' };
                  try {
                    await profileOverlayUpsert(`custom:repo:${Date.now()}`, 'add', fields);
                    toast.show({ type: 'success', title: 'Added row' });
                    await loadProfile();
                  } catch (e) {
                    toast.show({ type: 'error', title: `Couldn't save edit. ${e}` });
                  }
                }}>Add row</Button>
              </div>
            </div>
            <ProfileSectionTable
              rows={sortedRepos}
              columns={REPOS_COLS}
              sectionLabel="Repos"
              onRowClick={setDrawerRow}
              onEdit={handleEdit}
              onHide={handleHide}
              onDelete={handleDelete}
              onReset={handleReset}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </Card>
        )}
      </div>

      {/* Tab 2: Accounts */}
      <div
        role="tabpanel"
        id="panel-accounts"
        aria-labelledby="tab-accounts"
        hidden={activeTab !== 'accounts'}
      >
        {loading ? (
          <ListSkeleton rows={5} />
        ) : sortedAccounts.length === 0 ? (
          <EmptyState
            label="No accounts detected"
            description="Git remotes and SSH keys usually surface at least one account. Check that the Git remote source class is enabled."
            actionLabel="Open Privacy settings"
            onAction={() => openRoute('settings-privacy')}
            testId="profile-empty-accounts"
          />
        ) : (
          <Card tier={1} padding="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-3)' }}>
              <span className="t-h3">Accounts ({sortedAccounts.length})</span>
              <Button variant="ghost" size="sm" onClick={() => {
                const fakeRow: RenderedRow = {
                  row_id: `custom:account:${Date.now()}`,
                  row_kind: 'account',
                  fields: { platform: '', handle: '' },
                  source_scanner: 'manual',
                  orphaned: false,
                  edited: false,
                  overlay_action: 'add',
                };
                setEditRow(fakeRow);
              }}>Add row</Button>
            </div>
            <ProfileSectionTable
              rows={sortedAccounts}
              columns={ACCOUNTS_COLS}
              sectionLabel="Accounts"
              onRowClick={setDrawerRow}
              onEdit={handleEdit}
              onHide={handleHide}
              onDelete={handleDelete}
              onReset={handleReset}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </Card>
        )}
      </div>

      {/* Tab 3: Stack */}
      <div
        role="tabpanel"
        id="panel-stack"
        aria-labelledby="tab-stack"
        hidden={activeTab !== 'stack'}
      >
        {loading ? <ListSkeleton rows={4} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--s-4)' }}>
            {/* Languages */}
            <Card tier={2} padding="md">
              <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>Languages</h3>
              {topLangs.length === 0 ? (
                <p style={{ color: 'var(--t-3)', fontSize: 14 }}>No languages detected</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                  {topLangs.map(([lang, count]) => (
                    <div key={lang}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--t-2)', marginBottom: 2 }}>
                        <span>{lang}</span><span>{count}</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(count / maxLangCount) * 100}%`, background: 'var(--a-cool)', borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Package managers */}
            <Card tier={2} padding="md">
              <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>Package managers</h3>
              {detectedTools.filter(r => String(r.fields.tool_type ?? '') === 'package_manager' || String(r.fields.category ?? '') === 'package_manager').length === 0 ? (
                <p style={{ color: 'var(--t-3)', fontSize: 14 }}>None detected</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
                  {detectedTools
                    .filter(r => String(r.fields.tool_type ?? '') === 'package_manager' || String(r.fields.category ?? '') === 'package_manager')
                    .map(r => <Pill key={r.row_id} tone="free">{String(r.fields.cli ?? r.fields.name ?? r.row_id)}</Pill>)}
                </div>
              )}
            </Card>

            {/* Installed CLIs */}
            <Card tier={2} padding="md">
              <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>Installed CLIs</h3>
              {detectedTools.length === 0 ? (
                <EmptyState
                  label="Nothing installed detected"
                  description="Run a scan with the Installed CLIs class enabled to see your dev toolkit."
                  actionLabel="Re-scan now"
                  onAction={handleRescan}
                  testId="profile-empty-stack"
                />
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
                  {detectedTools.map(r => <Pill key={r.row_id} tone="pro">{String(r.fields.cli ?? r.fields.name ?? r.row_id)}</Pill>)}
                </div>
              )}
            </Card>

            {/* IDEs */}
            <Card tier={2} padding="md">
              <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>IDEs</h3>
              {detectedIdes.length === 0 ? (
                <p style={{ color: 'var(--t-3)', fontSize: 14 }}>No IDEs detected</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                  {detectedIdes.map(r => (
                    <div key={r.row_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                      <Pill tone="pro">{String(r.fields.name ?? r.row_id)}</Pill>
                      {r.fields.recent_projects != null && (
                        <span style={{ fontSize: 13, color: 'var(--t-3)' }}>
                          {String(r.fields.recent_projects)} projects
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Tab 4: Rhythm */}
      <div
        role="tabpanel"
        id="panel-rhythm"
        aria-labelledby="tab-rhythm"
        hidden={activeTab !== 'rhythm'}
      >
        {loading ? <ListSkeleton rows={4} /> : (
          profile?.rhythm_signals?.length === 0 && !rhythmNarrative ? (
            <EmptyState
              label="No rhythm signals yet"
              description="Rhythm needs shell history or AI session timestamps. Enable those source classes and re-scan."
              actionLabel="Open Privacy settings"
              onAction={() => openRoute('settings-privacy')}
              testId="profile-empty-rhythm"
            />
          ) : (
            <Card tier={1} padding="lg">
              <h3 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Activity by hour</h3>
              <RhythmHeatmap hourData={hourData} />

              <h3 className="t-h3" style={{ margin: 'var(--s-6) 0 var(--s-3)' }}>Weekly distribution</h3>
              <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-end', height: 60 }}>
                {DAY_LABELS.map((day, i) => (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(4, (dayOfWeekData[i] / maxDayCount) * 48)}px`,
                      background: 'var(--a-cool)',
                      borderRadius: '2px 2px 0 0',
                    }} />
                    <span style={{ fontSize: 10, color: 'var(--t-3)' }}>{day.slice(0, 1)}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 'var(--s-4)' }}>
                {rhythmNarrative ? (
                  <p className="t-body" style={{ color: 'var(--t-2)', display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                    <Pill tone="new">inferred</Pill> {rhythmNarrative}
                  </p>
                ) : (
                  <p className="t-body" style={{ color: 'var(--t-3)' }}>
                    Narrative not generated — no long-context provider configured.{' '}
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--a-cool)', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }}
                      onClick={() => openRoute('settings-providers')}
                    >
                      Configure
                    </button>
                  </p>
                )}
              </div>
            </Card>
          )
        )}
      </div>

      {/* Tab 5: Files */}
      <div
        role="tabpanel"
        id="panel-files"
        aria-labelledby="tab-files"
        hidden={activeTab !== 'files'}
      >
        {loading ? <ListSkeleton rows={5} /> : sortedMru.length === 0 ? (
          <EmptyState
            label="No recent files"
            description="Expand the window or enable the Filesystem MRU source class."
            actionLabel="Re-scan now"
            onAction={handleRescan}
            testId="profile-empty-files"
          />
        ) : (
          <Card tier={1} padding="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-3)' }}>
              <span className="t-h3">Files ({sortedMru.length})</span>
              <div style={{ display: 'flex', gap: 'var(--s-1)' }} role="group" aria-label="Time window">
                {(['7d', '30d', 'all'] as MruWindow[]).map((w) => (
                  <button
                    key={w}
                    className="identity-tab-pill"
                    data-active={String(mruWindow === w)}
                    onClick={() => setMruWindow(w)}
                  >
                    {w === 'all' ? 'All' : w}
                  </button>
                ))}
              </div>
            </div>
            <ProfileSectionTable
              rows={sortedMru}
              columns={FILES_COLS}
              sectionLabel="Files"
              onRowClick={setDrawerRow}
              onEdit={handleEdit}
              onHide={handleHide}
              onDelete={handleDelete}
              onReset={handleReset}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </Card>
        )}
      </div>

      {/* Lead-details drawer */}
      <LeadDetailsDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />

      {/* Edit dialog */}
      <EditSectionDialog
        open={editRow != null}
        title={editRow
          ? String(editRow.fields.path ?? editRow.fields.handle ?? editRow.row_id)
          : ''}
        initialContent={editRow ? fieldsToText(editRow.fields) : ''}
        onClose={() => setEditRow(null)}
        onSave={handleSaveEdit}
        placeholder="key: value (one per line)"
      />
    </section>
  );
}
