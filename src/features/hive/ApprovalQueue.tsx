// src/features/hive/ApprovalQueue.tsx — HIVE-04 (SC-4 falsifier).
//
// Pending decisions queue. Derives rows from hiveGetStatus().recent_decisions.
// Per-row Approve (hiveApproveDecision), Reject (hiveRejectDecision — Plan
// 09-01 closed D-205 backend gap), batch-approve-low-risk (Reply, confidence
// > 0.8) Dialog-gated. Subscribes HIVE_PENDING_DECISIONS / HIVE_ESCALATE /
// HIVE_ACTION_DEFERRED.
//
// @see .planning/phases/09-polish/09-01-PLAN.md (Reject backfill)
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 3)
// @see .planning/phases/08-body-hive/08-PATTERNS.md §5
// @see .planning/REQUIREMENTS.md §HIVE-04

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, GlassPanel, Pill, EmptyState } from '@/design-system/primitives';
import { ListSkeleton } from '@/design-system/primitives/ListSkeleton';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { HiveEscalatePayload } from '@/lib/events';
import { hiveApproveDecision, hiveGetStatus, hiveRejectDecision } from '@/lib/tauri/hive';
import type { Decision } from '@/lib/tauri/hive';
import './hive.css';

type DecisionType = Decision['type'];

interface PendingRow {
  headId: string;
  decisionIndex: number;
  decision: Decision;
  id: string; // stable key: `${headId}-${decisionIndex}`
}

const FILTERS: Array<DecisionType | 'All'> = ['All', 'Reply', 'Escalate', 'Act', 'Inform'];

function typeClass(t: DecisionType): string {
  return `type-${t.toLowerCase()}`;
}

function renderDecision(d: Decision): { summary: string; detail: unknown } {
  switch (d.type) {
    case 'Reply':
      return {
        summary: `Reply to ${d.data.to} on ${d.data.platform} (${(d.data.confidence * 100).toFixed(0)}%)`,
        detail: d.data,
      };
    case 'Escalate':
      return { summary: d.data.reason, detail: d.data };
    case 'Act':
      return {
        summary: `${d.data.action} on ${d.data.platform}${d.data.reversible ? '' : ' (irreversible)'}`,
        detail: d.data,
      };
    case 'Inform':
      return { summary: d.data.summary, detail: d.data };
  }
}

export function ApprovalQueue() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<DecisionType | 'All'>('All');
  const [batchDialog, setBatchDialog] = useState<{ count: number } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const expandedId = (prefs['hive.approval.expandedId'] as string | undefined) ?? '';

  const refresh = useCallback(() => {
    hiveGetStatus()
      .then((s) => {
        const flat: PendingRow[] = s.recent_decisions.map((d, i) => ({
          headId: 'combined',
          decisionIndex: i,
          decision: d,
          id: `combined-${i}`,
        }));
        setRows(flat);
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent(BLADE_EVENTS.HIVE_PENDING_DECISIONS, () => {
    refresh();
  });

  useTauriEvent<HiveEscalatePayload>(BLADE_EVENTS.HIVE_ESCALATE, (e) => {
    const p = e.payload;
    toast.show({
      type: 'warn',
      title: 'Hive escalation',
      message: p?.reason ?? '',
    });
    refresh();
  });

  useTauriEvent(BLADE_EVENTS.HIVE_ACTION_DEFERRED, () => {
    refresh();
  });

  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !dismissed.has(r.id) &&
          (filter === 'All' || r.decision.type === filter),
      ),
    [rows, dismissed, filter],
  );

  const lowRisk = useMemo(
    () =>
      visibleRows.filter(
        (r) => r.decision.type === 'Reply' && r.decision.data.confidence > 0.8,
      ),
    [visibleRows],
  );

  const approve = async (r: PendingRow) => {
    setBusyRow(r.id);
    try {
      await hiveApproveDecision({
        headId: r.headId,
        decisionIndex: r.decisionIndex,
      });
      toast.show({ type: 'success', title: 'Approved' });
      setDismissed((prev) => new Set(prev).add(r.id));
      refresh();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Approve failed',
        message: String(err),
      });
    } finally {
      setBusyRow(null);
    }
  };

  const reject = async (r: PendingRow) => {
    setBusyRow(r.id);
    try {
      await hiveRejectDecision({
        headId: r.headId,
        decisionIndex: r.decisionIndex,
      });
      toast.show({ type: 'success', title: 'Rejected' });
      // Optimistic local removal; next HIVE_PENDING_DECISIONS event will
      // reconcile with backend truth.
      setDismissed((prev) => new Set(prev).add(r.id));
      refresh();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Reject failed',
        message: String(err),
      });
    } finally {
      setBusyRow(null);
    }
  };

  const toggleExpand = (id: string) => {
    setPref('hive.approval.expandedId', expandedId === id ? '' : id);
  };

  const batchApprove = async () => {
    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    for (const r of lowRisk) {
      try {
        await hiveApproveDecision({
          headId: r.headId,
          decisionIndex: r.decisionIndex,
        });
        ok += 1;
        setDismissed((prev) => new Set(prev).add(r.id));
      } catch {
        fail += 1;
      }
    }
    toast.show({
      type: fail === 0 ? 'success' : 'warn',
      title: `Batch approve: ${ok} ok, ${fail} failed`,
    });
    setBatchBusy(false);
    setBatchDialog(null);
    refresh();
  };

  if (loadError) {
    return (
      <GlassPanel className="approval-queue" data-testid="approval-queue-root">
        <h2 style={{ margin: 0 }}>Approval Queue</h2>
        <p style={{ color: 'var(--status-error)' }}>Failed to load: {loadError}</p>
      </GlassPanel>
    );
  }

  return (
    <div className="approval-queue" data-testid="approval-queue-root">
      <GlassPanel className="approval-header">
        <h2 style={{ margin: 0 }}>Approval Queue</h2>
        <div className="approval-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip ${filter === f ? 'pro' : ''}`}
              onClick={() => setFilter(f)}
              data-testid={`approval-filter-${f.toLowerCase()}`}
            >
              {f}
            </button>
          ))}
        </div>
        <Button
          onClick={() => setBatchDialog({ count: lowRisk.length })}
          disabled={lowRisk.length === 0 || batchBusy}
          data-testid="batch-approve-low-risk"
        >
          Approve all low-risk ({lowRisk.length})
        </Button>
        <span style={{ fontSize: 12, color: 'var(--t-2)' }}>
          {visibleRows.length}/{rows.length - dismissed.size} shown
        </span>
      </GlassPanel>

      {initialLoading ? (
        <ListSkeleton rows={4} />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          label="Nothing to approve"
          description="All caught up."
        />
      ) : (
        visibleRows.map((r, i) => {
          const { summary, detail } = renderDecision(r.decision);
          const expanded = expandedId === r.id;
          return (
            <div
              key={r.id}
              className={`approval-row ${expanded ? 'expanded' : ''}`}
              data-testid={`approval-row-${i}`}
            >
              <Pill className={typeClass(r.decision.type)}>
                <span className={`decision-type ${typeClass(r.decision.type)}`}>
                  {r.decision.type}
                </span>
              </Pill>
              <div>
                <button
                  type="button"
                  onClick={() => toggleExpand(r.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--t-1)',
                    textAlign: 'left',
                    fontSize: 13,
                  }}
                >
                  {summary}
                </button>
                {r.decision.type === 'Reply' && (
                  <pre className="decision-details" style={{ marginTop: 'var(--space-2)' }}>
                    {r.decision.data.draft}
                  </pre>
                )}
                {r.decision.type === 'Act' && !r.decision.data.reversible && (
                  <Pill tone="new" style={{ marginTop: 'var(--space-2)' }}>
                    irreversible
                  </Pill>
                )}
                {expanded && (
                  <pre className="decision-details" style={{ marginTop: 'var(--space-2)' }}>
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                )}
              </div>
              <div className="decision-actions">
                <Button
                  variant="primary"
                  onClick={() => approve(r)}
                  disabled={busyRow === r.id}
                  data-testid={`approve-${i}`}
                >
                  {busyRow === r.id ? '…' : 'Approve'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => reject(r)}
                  disabled={busyRow === r.id}
                  data-testid={`reject-${i}`}
                >
                  {busyRow === r.id ? '…' : 'Reject'}
                </Button>
              </div>
            </div>
          );
        })
      )}

      <Dialog
        open={batchDialog !== null}
        onClose={() => !batchBusy && setBatchDialog(null)}
        ariaLabel="Batch approve low-risk"
      >
        <h3 style={{ margin: 0 }}>Approve {batchDialog?.count} low-risk decisions?</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Low-risk = Reply with confidence &gt; 0.8. Each will be approved via
          hive_approve_decision sequentially.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" onClick={() => setBatchDialog(null)} disabled={batchBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={batchApprove} disabled={batchBusy}>
            {batchBusy ? 'Approving…' : 'Confirm'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
