// src/features/hive/HiveMesh.tsx — HIVE-01 (SC-3 falsifier).
//
// The Hive landing — 10-tentacle grid + global autonomy + live subscriptions
// to hive_tick/hive_action/hive_inform/hive_ci_failure/hive_auto_fix_started
// + tentacle_error. Click card → setPref('hive.activeTentacle') +
// router.openRoute('hive-tentacle').
//
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 1)
// @see .planning/phases/08-body-hive/08-PATTERNS.md §4
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-204
// @see .planning/REQUIREMENTS.md §HIVE-01

import { useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, Pill, EmptyState } from '@/design-system/primitives';
import { ListSkeleton } from '@/design-system/primitives/ListSkeleton';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  HiveActionPayload,
  HiveAutoFixStartedPayload,
  HiveCiFailurePayload,
  HiveInformPayload,
  HiveTickPayload,
  TentacleErrorPayload,
} from '@/lib/events';
import { hiveGetStatus, hiveSetAutonomy, hiveStart } from '@/lib/tauri/hive';
import type { Decision, HiveStatus, TentacleSummary } from '@/lib/tauri/hive';
import { useRouterCtx } from '@/windows/main/useRouter';
import './hive.css';

type StatusFilter = 'all' | 'active' | 'dormant' | 'error' | 'disconnected';

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'active',
  'dormant',
  'error',
  'disconnected',
];

function relTime(epoch: number): string {
  if (!epoch) return 'never';
  const now = Date.now() / 1000;
  const delta = Math.max(0, now - epoch);
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function decisionSummary(d: Decision): string {
  switch (d.type) {
    case 'Reply':
      return `Reply on ${d.data.platform} to ${d.data.to} (${(d.data.confidence * 100).toFixed(0)}%)`;
    case 'Escalate':
      return `Escalate — ${d.data.reason}`;
    case 'Act':
      return `${d.data.action} on ${d.data.platform}${d.data.reversible ? '' : ' (irreversible)'}`;
    case 'Inform':
      return d.data.summary;
  }
}

export function HiveMesh() {
  const router = useRouterCtx();
  const { prefs, setPref } = usePrefs();
  const toast = useToast();
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAutonomy, setPendingAutonomy] = useState<number | null>(null);
  const [confirmAutonomy, setConfirmAutonomy] = useState<number | null>(null);

  const filter = (prefs['hive.filterStatus'] as StatusFilter | undefined) ?? 'all';

  useEffect(() => {
    hiveGetStatus().then(setStatus).catch((e) => setError(String(e)));
  }, []);

  // Live tick — refresh whole status from payload if present, else re-fetch.
  useTauriEvent<HiveTickPayload>(BLADE_EVENTS.HIVE_TICK, () => {
    hiveGetStatus().then(setStatus).catch(() => {});
  });

  useTauriEvent<HiveActionPayload>(BLADE_EVENTS.HIVE_ACTION, (e) => {
    const p = e.payload ?? ({} as HiveActionPayload);
    toast.show({
      type: 'success',
      title: 'Hive acted',
      message: `${p.action ?? 'action'} on ${p.platform ?? 'unknown'}`,
    });
  });

  useTauriEvent<HiveInformPayload>(BLADE_EVENTS.HIVE_INFORM, (e) => {
    toast.show({
      type: 'info',
      title: 'Hive',
      message: String(e.payload?.summary ?? ''),
    });
  });

  useTauriEvent<HiveCiFailurePayload>(BLADE_EVENTS.HIVE_CI_FAILURE, (e) => {
    const p = e.payload ?? ({} as HiveCiFailurePayload);
    toast.show({
      type: 'error',
      title: 'CI failure',
      message: p.repo ? `${p.repo}${p.branch ? `@${p.branch}` : ''}` : p.error,
    });
  });

  useTauriEvent<HiveAutoFixStartedPayload>(BLADE_EVENTS.HIVE_AUTO_FIX_STARTED, (e) => {
    toast.show({
      type: 'info',
      title: 'Auto-fix started',
      message: e.payload?.repo ?? e.payload?.pipeline_id,
    });
  });

  // tentacle_error flips the matching tentacle's status to 'Error' optimistically.
  useTauriEvent<TentacleErrorPayload>(BLADE_EVENTS.TENTACLE_ERROR, (e) => {
    const p = e.payload;
    if (!p) return;
    setStatus((prev) => {
      if (!prev) return prev;
      const updated = prev.tentacles.map((t) =>
        t.platform === p.platform || t.id === p.tentacle_id
          ? { ...t, status: 'Error' as const }
          : t,
      );
      return { ...prev, tentacles: updated };
    });
    toast.show({
      type: 'error',
      title: `Tentacle ${p.platform} error`,
      message: p.error,
    });
  });

  const onAutonomyChange = (level: number) => {
    if (!status) return;
    // Optimistic UI update.
    setStatus({ ...status, autonomy: level });
    if (level >= 0.7) {
      setConfirmAutonomy(level);
    } else {
      commitAutonomy(level);
    }
  };

  const commitAutonomy = async (level: number) => {
    setPendingAutonomy(level);
    try {
      await hiveSetAutonomy({ level });
      toast.show({
        type: 'success',
        title: `Autonomy ${level.toFixed(2)}`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Set autonomy failed',
        message: String(err),
      });
    } finally {
      setPendingAutonomy(null);
      setConfirmAutonomy(null);
    }
  };

  const onCardClick = (t: TentacleSummary) => {
    setPref('hive.activeTentacle', t.platform);
    router.openRoute('hive-tentacle');
  };

  const tentacles = status?.tentacles ?? [];
  const filtered = tentacles.filter((t) =>
    filter === 'all' ? true : t.status.toLowerCase() === filter,
  );

  if (error) {
    return (
      <GlassPanel className="hive-mesh" data-testid="hive-mesh-root">
        <h2 style={{ margin: 0 }}>Hive</h2>
        <p style={{ color: 'var(--status-error)' }}>Failed to load hive status: {error}</p>
      </GlassPanel>
    );
  }

  if (!status) {
    return (
      <GlassPanel className="hive-mesh" data-testid="hive-mesh-root">
        <ListSkeleton rows={5} />
      </GlassPanel>
    );
  }

  if (tentacles.length === 0) {
    return (
      <GlassPanel className="hive-mesh" data-testid="hive-mesh-root">
        <EmptyState
          label="Hive not running"
          description="Start the hive to spawn tentacles and collect signals."
          actionLabel="Start hive"
          onAction={() => {
            hiveStart()
              .then(setStatus)
              .catch((err) =>
                toast.show({
                  type: 'error',
                  title: 'Failed to start hive',
                  message: String(err),
                }),
              );
          }}
        />
      </GlassPanel>
    );
  }

  return (
    <div className="hive-mesh" data-testid="hive-mesh-root">
      <GlassPanel className="hive-hero">
        <div className="hive-hero-grid">
          <div>
            <h2 style={{ margin: 0 }}>Hive Mesh</h2>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <Pill tone={status.running ? 'free' : 'default'} dot>
                {status.running ? 'Running' : 'Idle'}
              </Pill>
              <Pill>{status.active_tentacles}/{status.tentacle_count} active</Pill>
              <Pill>{status.head_count} heads</Pill>
            </div>
          </div>
          <div className="hive-hero-stats">
            <div><strong>{status.total_reports_processed}</strong><span>reports</span></div>
            <div><strong>{status.total_actions_taken}</strong><span>actions</span></div>
            <div><strong>{status.pending_decisions}</strong><span>pending</span></div>
            <div><strong>{relTime(status.last_tick)}</strong><span>last tick</span></div>
          </div>
          <div className="hive-autonomy">
            <label htmlFor="hive-autonomy-slider" className="hive-autonomy-label">
              Global autonomy: <strong>{status.autonomy.toFixed(2)}</strong>
            </label>
            <input
              id="hive-autonomy-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={status.autonomy}
              onChange={(e) => onAutonomyChange(parseFloat(e.target.value))}
              disabled={pendingAutonomy !== null}
              data-testid="hive-autonomy-slider"
              aria-label="Global hive autonomy"
            />
            <div className="hive-autonomy-scale">
              <span>ask</span><span>confident</span><span>full</span>
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="hive-filters" data-testid="hive-filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip ${filter === f ? 'pro' : ''}`}
            onClick={() => setPref('hive.filterStatus', f)}
            data-testid={`hive-filter-${f}`}
          >
            {f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-2)' }}>
          {filtered.length}/{tentacles.length} shown
        </span>
      </GlassPanel>

      <div className="tentacle-grid list-entrance" data-testid="tentacle-grid">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tentacle-card status-${t.status.toLowerCase()}`}
            onClick={() => onCardClick(t)}
            data-testid={`tentacle-card-${t.platform}`}
          >
            <div className="tentacle-platform">{t.platform}</div>
            <div className="tentacle-status">{t.status}</div>
            <div className="tentacle-head">→ {t.head}</div>
            <div className="tentacle-reports">
              {t.pending_report_count} pending · {t.messages_processed} seen
            </div>
            <div className="tentacle-heartbeat">{relTime(t.last_heartbeat)}</div>
          </button>
        ))}
      </div>

      <GlassPanel className="hive-decisions">
        <h3 style={{ margin: 0 }}>Recent decisions</h3>
        {status.recent_decisions.length === 0 ? (
          <p style={{ color: 'var(--t-2)', fontSize: 13 }}>No recent decisions.</p>
        ) : (
          <ul className="hive-decisions-list">
            {status.recent_decisions.slice(0, 8).map((d, i) => (
              <li key={i}>
                <Pill tone={
                  d.type === 'Escalate' ? 'new'
                  : d.type === 'Act' ? 'free'
                  : d.type === 'Reply' ? 'pro'
                  : 'default'
                }>{d.type}</Pill>
                <span className="hive-decision-summary">{decisionSummary(d)}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <Dialog
        open={confirmAutonomy !== null}
        onClose={() => {
          setConfirmAutonomy(null);
          // Revert optimistic value
          hiveGetStatus().then(setStatus).catch(() => {});
        }}
        ariaLabel="Confirm high hive autonomy"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>
          Raise hive autonomy to {confirmAutonomy?.toFixed(2)}?
        </h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Levels at 0.7 or higher let the hive take most actions without asking.
          This applies to every tentacle globally.
        </p>
        <div className="admin-dialog-actions" style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirmAutonomy(null);
              hiveGetStatus().then(setStatus).catch(() => {});
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => confirmAutonomy !== null && commitAutonomy(confirmAutonomy)}
            disabled={pendingAutonomy !== null}
          >
            {pendingAutonomy !== null ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
