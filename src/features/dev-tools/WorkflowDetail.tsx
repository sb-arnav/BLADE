// src/features/dev-tools/WorkflowDetail.tsx — Plan 07-03 Task 2 (DEV-05 sub).
//
// Detail pane for WorkflowBuilder selection. Tabs: Steps / Runs / Schedule.
// Tab persisted in prefs['devTools.activeTab'] under the 'workflow:' key
// prefix (so it doesn't collide with ComputerUse / DocumentGenerator tabs).
//
// Schedule tab checks cron_list for matching entries; allows add/remove.
// Per Pattern §4 destructive ops use Dialog with variant="danger" button.
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 2
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §7

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  workflowUpdate,
  workflowDelete,
  cronAdd,
  cronList,
  cronDelete,
} from '@/lib/tauri/dev_tools';
import type { Workflow, WorkflowRun, CronJob } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-a.css';

type DetailTab = 'steps' | 'runs' | 'schedule';
const TAB_PREFS_KEY = 'devTools.activeTab' as const;
const TAB_PREFIX = 'workflow:';
const VALID_TABS: DetailTab[] = ['steps', 'runs', 'schedule'];

interface Props {
  workflow: Workflow;
  runs: WorkflowRun[];
  onRefresh: () => void;
  onDeleted: () => void;
}

function formatDuration(started?: number | null, ended?: number | null): string {
  if (!started || !ended) return '—';
  const secs = Math.max(0, ended - started);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatTimestamp(ts?: number | null): string {
  if (!ts) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

function cronNameFor(workflowId: string): string {
  return `workflow-${workflowId}`;
}

function statusToDataToken(status: string): string {
  if (status === 'success') return 'complete';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'idle';
}

export function WorkflowDetail({ workflow, runs, onRefresh, onDeleted }: Props) {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();

  // Decode pref — it's a single string; we encode `<prefix><tab>` so the key
  // doesn't collide with other tabbed surfaces under the same pref key.
  const storedTab = prefs[TAB_PREFS_KEY] as string | undefined;
  const initialTab: DetailTab = useMemo(() => {
    if (storedTab && storedTab.startsWith(TAB_PREFIX)) {
      const suffix = storedTab.slice(TAB_PREFIX.length) as DetailTab;
      if (VALID_TABS.includes(suffix)) return suffix;
    }
    return 'steps';
  }, [storedTab]);

  const [tab, setTab] = useState<DetailTab>(initialTab);

  const selectTab = useCallback(
    (t: DetailTab) => {
      setTab(t);
      setPref(TAB_PREFS_KEY, `${TAB_PREFIX}${t}`);
    },
    [setPref],
  );

  // Schedule state
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleText, setScheduleText] = useState('daily 09:00');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [removeCronId, setRemoveCronId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(workflow.name);
  const [editDescription, setEditDescription] = useState(workflow.description);
  const [editBusy, setEditBusy] = useState(false);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Reset edit fields when workflow changes.
  useEffect(() => {
    setEditName(workflow.name);
    setEditDescription(workflow.description);
  }, [workflow.id, workflow.name, workflow.description]);

  // Load cron jobs when Schedule tab is active.
  useEffect(() => {
    if (tab !== 'schedule') return;
    let cancelled = false;
    setCronLoading(true);
    cronList()
      .then((jobs) => {
        if (!cancelled) setCronJobs(jobs);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.show({
            type: 'error',
            title: 'Could not list cron jobs',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setCronLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, workflow.id, toast]);

  const matchingCron = useMemo(() => {
    const target = cronNameFor(workflow.id);
    return cronJobs.find((j) => j.name === target) ?? null;
  }, [cronJobs, workflow.id]);

  const doAddSchedule = useCallback(async () => {
    const text = scheduleText.trim();
    if (!text) return;
    setScheduleBusy(true);
    try {
      // action_kind 'workflow' + action_payload carrying the workflow id lets
      // the Rust cron dispatcher (cron.rs) route back to workflow_run_now on
      // tick. If the kind isn't registered today, the cron row still lands
      // and the scheduler will skip with a log — graceful.
      await cronAdd({
        name: cronNameFor(workflow.id),
        description: `Run workflow: ${workflow.name}`,
        scheduleText: text,
        actionKind: 'workflow',
        actionPayload: { workflow_id: workflow.id },
      });
      toast.show({
        type: 'success',
        title: 'Schedule added',
        message: text,
      });
      // Refresh cron list.
      const jobs = await cronList();
      setCronJobs(jobs);
      setScheduleOpen(false);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Schedule add failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScheduleBusy(false);
    }
  }, [scheduleText, workflow.id, workflow.name, toast]);

  const doRemoveSchedule = useCallback(async () => {
    if (!removeCronId) return;
    setRemoveBusy(true);
    try {
      await cronDelete(removeCronId);
      toast.show({ type: 'success', title: 'Schedule removed' });
      const jobs = await cronList();
      setCronJobs(jobs);
      setRemoveCronId(null);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Schedule remove failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRemoveBusy(false);
    }
  }, [removeCronId, toast]);

  const doEdit = useCallback(async () => {
    setEditBusy(true);
    try {
      const updated: Workflow = {
        ...workflow,
        name: editName.trim() || workflow.name,
        description: editDescription,
      };
      await workflowUpdate(updated);
      toast.show({ type: 'success', title: 'Workflow updated' });
      setEditOpen(false);
      onRefresh();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEditBusy(false);
    }
  }, [workflow, editName, editDescription, onRefresh, toast]);

  const doDelete = useCallback(async () => {
    setDeleteBusy(true);
    try {
      await workflowDelete(workflow.id);
      toast.show({ type: 'success', title: 'Workflow deleted' });
      setDeleteOpen(false);
      onDeleted();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleteBusy(false);
    }
  }, [workflow.id, onDeleted, toast]);

  return (
    <div className="workflow-detail-root" data-testid="workflow-detail-root">
      <div className="workflow-detail-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="workflow-detail-title">{workflow.name}</h2>
          {workflow.description && (
            <p className="workflow-detail-description">{workflow.description}</p>
          )}
          <div style={{ color: 'var(--t-3)', fontSize: 11, marginTop: 4 }}>
            <code style={{ fontFamily: 'var(--font-mono)' }}>id: {workflow.id}</code>
            {' · '}
            {workflow.run_count} run{workflow.run_count === 1 ? '' : 's'}
            {workflow.last_run ? ` · last ${formatTimestamp(workflow.last_run)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            data-testid="workflow-edit-button"
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            data-testid="workflow-delete-button"
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="dev-tab-row">
        {VALID_TABS.map((t) => (
          <button
            key={t}
            className="dev-tab-pill"
            data-active={tab === t}
            onClick={() => selectTab(t)}
            data-testid="workflow-tab"
            data-tab={t}
          >
            {t === 'steps' ? 'Steps' : t === 'runs' ? 'Runs' : 'Schedule'}
          </button>
        ))}
      </div>

      {tab === 'steps' && (
        <div className="workflow-detail-section" data-testid="workflow-steps-panel">
          {workflow.nodes.length === 0 && (
            <div className="workflow-empty-state">This workflow has no steps yet.</div>
          )}
          {workflow.nodes.map((node, i) => (
            <div key={node.id || i} className="workflow-step-row">
              <span className="workflow-step-index">{i + 1}</span>
              <div>
                <div className="workflow-step-type">{node.node_type}</div>
                <pre className="workflow-step-config">
                  {JSON.stringify(node.config, null, 2)}
                </pre>
                {node.next_nodes.length > 0 && (
                  <div style={{ color: 'var(--t-3)', fontSize: 11, marginTop: 4 }}>
                    → next: {node.next_nodes.join(', ')}
                  </div>
                )}
                {node.on_error && (
                  <div style={{ color: 'var(--status-error)', fontSize: 11, marginTop: 2 }}>
                    on_error → {node.on_error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'runs' && (
        <div className="workflow-detail-section" data-testid="workflow-runs-list">
          {runs.length === 0 && (
            <div className="workflow-empty-state">No runs yet. Click "Run now" above.</div>
          )}
          {runs.map((run) => {
            const firstOutput = Object.values(run.node_outputs)[0] ?? '';
            return (
              <div
                key={run.run_id}
                className="dev-card"
                data-status={statusToDataToken(run.status)}
                data-testid="workflow-run-card"
              >
                <div className="workflow-run-card">
                  <span
                    className="workflow-status-chip"
                    data-status={run.status}
                  >
                    {run.status}
                  </span>
                  <div>
                    <div style={{ color: 'var(--t-2)', fontSize: 12 }}>
                      {formatTimestamp(run.started_at)}
                    </div>
                    <div style={{ color: 'var(--t-3)', fontSize: 11 }}>
                      duration: {formatDuration(run.started_at, run.ended_at)}
                    </div>
                  </div>
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--t-3)',
                    }}
                  >
                    {run.run_id.slice(0, 8)}
                  </code>
                </div>
                {run.error && (
                  <pre
                    className="workflow-run-output"
                    style={{ color: 'var(--status-error)' }}
                  >
                    {run.error}
                  </pre>
                )}
                {!run.error && firstOutput && (
                  <pre className="workflow-run-output">{firstOutput}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="workflow-detail-section" data-testid="workflow-schedule-panel">
          {cronLoading && <div className="dev-placeholder-hint">Loading schedule…</div>}
          {!cronLoading && matchingCron && (
            <div className="dev-card" data-status="running">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ color: 'var(--t-1)', fontWeight: 600 }}>
                    Scheduled
                  </div>
                  <div
                    style={{
                      color: 'var(--t-3)',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {matchingCron.schedule.kind}
                    {matchingCron.schedule.time_of_day != null
                      ? ` @ ${matchingCron.schedule.time_of_day}`
                      : ''}
                    {matchingCron.schedule.interval_secs != null
                      ? ` every ${matchingCron.schedule.interval_secs}s`
                      : ''}
                  </div>
                  <div style={{ color: 'var(--t-3)', fontSize: 11, marginTop: 4 }}>
                    next run: {formatTimestamp(matchingCron.next_run)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveCronId(matchingCron.id)}
                  data-testid="workflow-remove-schedule"
                >
                  Remove schedule
                </Button>
              </div>
            </div>
          )}
          {!cronLoading && !matchingCron && (
            <div>
              <div className="dev-placeholder-hint" style={{ marginBottom: 'var(--s-2)' }}>
                No schedule yet for this workflow.
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setScheduleOpen(true)}
                data-testid="workflow-add-schedule"
              >
                Add schedule
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} ariaLabel="Edit workflow">
        <h3 className="dialog-title">Edit workflow</h3>
        <div className="dialog-body">
          <label>
            Name
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="my workflow"
              aria-label="Workflow name"
            />
          </label>
          <label>
            Description
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="what does this do?"
            />
          </label>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doEdit}
            disabled={editBusy || !editName.trim()}
            data-testid="workflow-edit-save"
          >
            {editBusy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Dialog>

      {/* Delete confirm dialog (T-07-03-05 — Dialog-confirm per Pattern §4) */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        ariaLabel="Delete workflow"
      >
        <h3 className="dialog-title">Delete workflow?</h3>
        <div className="dialog-body">
          <p style={{ color: 'var(--t-2)', margin: 0 }}>
            This removes <strong>{workflow.name}</strong> and its run history. This cannot
            be undone.
          </p>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doDelete}
            disabled={deleteBusy}
            data-testid="workflow-delete-confirm"
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>

      {/* Add schedule dialog */}
      <Dialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        ariaLabel="Add schedule"
      >
        <h3 className="dialog-title">Add schedule</h3>
        <div className="dialog-body">
          <label>
            Schedule expression
            <Input
              mono
              value={scheduleText}
              onChange={(e) => setScheduleText(e.target.value)}
              placeholder="daily 09:00"
              aria-label="Schedule expression"
            />
          </label>
          <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>
            Examples: <code>daily 09:00</code>, <code>weekly Mon 14:00</code>,{' '}
            <code>interval 3600s</code>
          </p>
        </div>
        <div className="dialog-actions">
          <Button
            variant="ghost"
            onClick={() => setScheduleOpen(false)}
            disabled={scheduleBusy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doAddSchedule}
            disabled={scheduleBusy || !scheduleText.trim()}
            data-testid="workflow-schedule-confirm"
          >
            {scheduleBusy ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </Dialog>

      {/* Remove schedule confirm */}
      <Dialog
        open={removeCronId !== null}
        onClose={() => setRemoveCronId(null)}
        ariaLabel="Remove schedule"
      >
        <h3 className="dialog-title">Remove schedule?</h3>
        <div className="dialog-body">
          <p style={{ color: 'var(--t-2)', margin: 0 }}>
            This stops future automatic runs of this workflow.
          </p>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setRemoveCronId(null)} disabled={removeBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doRemoveSchedule} disabled={removeBusy}>
            {removeBusy ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
