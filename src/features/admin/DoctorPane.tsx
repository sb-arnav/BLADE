// src/features/admin/DoctorPane.tsx
//
// Phase 17 Plan 17-06 — Doctor pane (DOCTOR-07, DOCTOR-08, DOCTOR-09).
// Lazy-loaded sub-tab inside Diagnostics.tsx. Renders 5 collapsible
// severity-striped rows (one per signal class) in the locked
// most-volatile-first order; clicking a row opens a Dialog drawer with
// the raw payload + suggested_fix copy + last-changed timestamp.
//
// Subscribes to BLADE_EVENTS.DOCTOR_EVENT via useTauriEvent — never raw
// listen() (D-13 / Plan 09 ESLint rule).
//
// @see .planning/phases/17-doctor-module/17-CONTEXT.md (D-12, D-13, D-15, D-21)
// @see .planning/phases/17-doctor-module/17-UI-SPEC.md §5..§8, §12, §14, §15
// @see src-tauri/src/doctor.rs (Rust orchestrator + emit site)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  doctorRunFullCheck,
  type DoctorSignal,
  type SignalClass,
  type Severity,
} from '@/lib/tauri/admin';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';
import type { DoctorEventPayload } from '@/lib/events/payloads';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ListSkeleton,
} from '@/design-system/primitives';

// UI-SPEC § 14.3 — locked display names per signal class
const DISPLAY_NAME: Record<SignalClass, string> = {
  eval_scores: 'Eval Scores',
  capability_gaps: 'Capability Gaps',
  tentacle_health: 'Tentacle Health',
  config_drift: 'Config Drift',
  auto_update: 'Auto-Update',
  reward_trend: 'Reward Trend',
  metacognitive: 'Metacognitive',
  hormones: 'Hormones',
};

// UI-SPEC § 7.5 — fixed most-volatile-first order. RewardTrend appended at
// end (least volatile — composite reward changes slowly) per Phase 23 D-23-04.
// Metacognitive appended after RewardTrend per Phase 25 META-05.
const ROW_ORDER: SignalClass[] = [
  'eval_scores',
  'capability_gaps',
  'tentacle_health',
  'config_drift',
  'auto_update',
  'reward_trend',
  'metacognitive',
  'hormones',
];

// UI-SPEC § 5.4 — badge tone mapping
function badgeTone(severity: Severity): 'ok' | 'warn' | 'hot' | 'default' {
  if (severity === 'green') return 'ok';
  if (severity === 'amber') return 'warn';
  if (severity === 'red') return 'hot';
  return 'default';
}

// UI-SPEC § 5.6 — relative-then-absolute timestamp
function formatTimestamp(unixMs: number): string {
  const ageSecs = Math.floor((Date.now() - unixMs) / 1000);
  if (ageSecs < 60) return 'just now';
  if (ageSecs < 3600) {
    const m = Math.floor(ageSecs / 60);
    return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  }
  if (ageSecs < 86400) {
    const h = Math.floor(ageSecs / 3600);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const d = new Date(unixMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DoctorRow({
  signal,
  expanded,
  onClick,
  rowRef,
}: {
  signal: DoctorSignal;
  expanded: boolean;
  onClick: () => void;
  rowRef: React.RefObject<HTMLButtonElement>;
}) {
  const name = DISPLAY_NAME[signal.class];
  const sev = signal.severity;
  // UI-SPEC § 12.5 — aria-label puts severity in text BEFORE timestamp
  const ariaLabel = `${name}. Severity ${sev}. Last changed ${formatTimestamp(signal.last_changed_at)}. Press Enter to view details.`;
  return (
    <button
      ref={rowRef}
      type="button"
      className="doctor-row"
      data-severity={sev}
      data-expanded={expanded ? 'true' : 'false'}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="doctor-row-name">{name}</span>
      <Badge tone={badgeTone(sev)} role="status">{sev.toUpperCase()}</Badge>
      <span className="doctor-row-meta">{formatTimestamp(signal.last_changed_at)}</span>
      <span className="doctor-row-chevron" aria-hidden="true">›</span>
    </button>
  );
}

export function DoctorPane() {
  const [signals, setSignals] = useState<DoctorSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openClass, setOpenClass] = useState<SignalClass | null>(null);

  // Per Pitfall 5 — one ref per row, never a shared ref
  const rowRefs = useMemo(() => {
    const map: Record<SignalClass, React.RefObject<HTMLButtonElement>> = {
      eval_scores: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      capability_gaps: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      tentacle_health: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      config_drift: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      auto_update: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      reward_trend: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      metacognitive: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
    };
    return map;
  }, []);

  const refresh = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await doctorRunFullCheck();
      setSignals(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  // Live updates per CONTEXT.md D-12 (c)
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  const handleEvent = useCallback((e: Event<DoctorEventPayload>) => {
    const p = e.payload;
    const next = signalsRef.current.map((sig) =>
      sig.class === p.class
        ? {
            ...sig,
            severity: p.severity,
            last_changed_at: p.last_changed_at,
            payload: p.payload,
          }
        : sig
    );
    signalsRef.current = next;
    setSignals(next);
  }, []);

  useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, handleEvent);

  // Sort signals into the locked row order
  const orderedSignals = useMemo(() => {
    const byClass: Record<string, DoctorSignal> = {};
    for (const s of signals) byClass[s.class] = s;
    return ROW_ORDER.map((c) => byClass[c]).filter(Boolean);
  }, [signals]);

  const allGreen = orderedSignals.length > 0 && orderedSignals.every((s) => s.severity === 'green');
  const lastCheckedMs = orderedSignals.length > 0
    ? Math.max(...orderedSignals.map((s) => s.last_changed_at))
    : null;

  const openSignal = openClass
    ? orderedSignals.find((s) => s.class === openClass) ?? null
    : null;

  // Page-level error state
  if (error && !loading) {
    return (
      <section className="diagnostics-section">
        <h4 className="diagnostics-section-title">Doctor</h4>
        <EmptyState
          label="Doctor unavailable"
          description={`Could not run full check. Tauri command failed: ${error}`}
          actionLabel="Retry"
          onAction={() => refresh(false)}
        />
      </section>
    );
  }

  return (
    <section className="diagnostics-section">
      <h4 className="diagnostics-section-title">Doctor</h4>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-2)' }}>
        <span className="doctor-row-meta">
          {lastCheckedMs ? `Last full check ${formatTimestamp(lastCheckedMs)}` : ''}
        </span>
        <Button
          variant="ghost"
          onClick={() => refresh(true)}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? 'Re-checking…' : 'Re-run all checks'}
        </Button>
      </div>

      {loading && orderedSignals.length === 0 ? (
        <ListSkeleton rows={5} rowHeight={56} />
      ) : (
        <div className="doctor-row-list">
          {allGreen && lastCheckedMs && (
            <div
              className="doctor-row doctor-row--summary"
              data-severity="green"
            >
              <span className="doctor-row-name">
                All signals green — last checked {formatTimestamp(lastCheckedMs)}
              </span>
            </div>
          )}
          {orderedSignals.map((sig) => (
            <DoctorRow
              key={sig.class}
              signal={sig}
              expanded={openClass === sig.class}
              onClick={() => setOpenClass(sig.class)}
              rowRef={rowRefs[sig.class]}
            />
          ))}
        </div>
      )}

      {openSignal && (
        <Dialog
          open={!!openSignal}
          onClose={() => setOpenClass(null)}
          ariaLabel={`Doctor signal details for ${DISPLAY_NAME[openSignal.class]}`}
          triggerRef={rowRefs[openSignal.class]}
        >
          <div className="doctor-drawer dialog">
            <div className="doctor-drawer-header">
              <h2 className="doctor-drawer-title">{DISPLAY_NAME[openSignal.class]}</h2>
              <Badge tone={badgeTone(openSignal.severity)} role="status">
                {openSignal.severity.toUpperCase()}
              </Badge>
              <button
                type="button"
                className="doctor-drawer-close"
                onClick={() => setOpenClass(null)}
                aria-label="Close drawer"
              >
                Close
              </button>
              <span className="doctor-drawer-meta">
                last changed {formatTimestamp(openSignal.last_changed_at)}
              </span>
            </div>
            <div className="doctor-drawer-body">
              <div>
                <p className="doctor-drawer-section-label">SUGGESTED FIX</p>
                <div className="doctor-drawer-fix-copy">{openSignal.suggested_fix}</div>
              </div>
              <div>
                <p className="doctor-drawer-section-label">RAW PAYLOAD</p>
                <pre
                  className="doctor-drawer-payload-pre"
                  aria-label="Raw payload JSON"
                >
                  {JSON.stringify(openSignal.payload, null, 2)}
                </pre>
              </div>
            </div>
            <div className="doctor-drawer-footer">
              <Button variant="ghost" onClick={() => refresh(true)} disabled={refreshing}>
                Re-check this signal
              </Button>
              <Button variant="secondary" onClick={() => setOpenClass(null)}>Close</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
