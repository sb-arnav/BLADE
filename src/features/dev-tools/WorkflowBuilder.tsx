// src/features/dev-tools/WorkflowBuilder.tsx — Plan 07-03 Task 2 (DEV-05).
//
// Real body per D-176 — sidebar list + detail pane for Workflow CRUD + runs.
// Top-actions: Run now, New workflow, Generate from description (with
// explicit preview + Save per D-176). Delete gated behind Dialog-confirm in
// WorkflowDetail (T-07-03-05 mitigation).
//
// Live runs subscription omitted per Plan 07-01 audit (workflow_run_started
// and workflow_run_completed emits do NOT exist in Rust). Polling on
// workflow_run_now completion is sufficient for Phase 7.
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 2
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §7

import { useCallback, useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  workflowList,
  workflowGet,
  workflowCreate,
  workflowRunNow,
  workflowGetRuns,
  workflowGenerateFromDescription,
} from '@/lib/tauri/dev_tools';
import type { Workflow, WorkflowRun } from '@/lib/tauri/dev_tools';
import { WorkflowDetail } from './WorkflowDetail';
import './dev-tools.css';
import './dev-tools-rich-a.css';

function newEmptyWorkflow(name: string, description: string): Workflow {
  return {
    id: '', // Rust fills via uuid::Uuid::new_v4() if empty.
    name,
    description,
    nodes: [],
    enabled: true,
    last_run: null,
    run_count: 0,
    created_at: 0, // Rust fills via chrono::Utc::now().timestamp() if 0.
  };
}

function summarizeRunStatus(runs: WorkflowRun[]): string {
  if (runs.length === 0) return 'never run';
  const latest = runs[0];
  return latest.status;
}

export function WorkflowBuilder() {
  const toast = useToast();

  const [list, setList] = useState<Workflow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runsByWorkflow, setRunsByWorkflow] = useState<Record<string, WorkflowRun[]>>({});

  // Run now state
  const [runBusy, setRunBusy] = useState(false);

  // New workflow dialog state
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newBusy, setNewBusy] = useState(false);

  // Generate-from-description dialog state
  const [genOpen, setGenOpen] = useState(false);
  const [genDescription, setGenDescription] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genPreview, setGenPreview] = useState<Workflow | null>(null);
  const [genSaveBusy, setGenSaveBusy] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const workflows = await workflowList();
      setList(workflows);
      // Preload last-run status for sidebar chips (parallel, don't halt on fail).
      const runEntries = await Promise.all(
        workflows.map(async (w) => {
          try {
            const rs = await workflowGetRuns(w.id);
            return [w.id, rs] as const;
          } catch {
            return [w.id, [] as WorkflowRun[]] as const;
          }
        }),
      );
      const map: Record<string, WorkflowRun[]> = {};
      for (const [id, rs] of runEntries) map[id] = rs;
      setRunsByWorkflow(map);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Could not list workflows',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setListLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const [wf, rs] = await Promise.all([
          workflowGet(id),
          workflowGetRuns(id),
        ]);
        setSelected(wf ?? null);
        // Sort runs newest-first; workflow_get_runs returns latest first by
        // convention but be defensive.
        const sorted = [...rs].sort((a, b) => b.started_at - a.started_at).slice(0, 20);
        setRuns(sorted);
        setRunsByWorkflow((prev) => ({ ...prev, [id]: sorted }));
      } catch (err) {
        setSelected(null);
        setRuns([]);
        toast.show({
          type: 'error',
          title: 'Could not load workflow',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setRuns([]);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const doRunNow = useCallback(async () => {
    if (!selectedId) return;
    setRunBusy(true);
    try {
      const run = await workflowRunNow(selectedId);
      toast.show({
        type: run.status === 'success' ? 'success' : 'info',
        title: `Run ${run.status}`,
        message: run.error ?? run.run_id.slice(0, 8),
      });
      // Refresh runs + sidebar.
      await loadDetail(selectedId);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Run failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunBusy(false);
    }
  }, [selectedId, loadDetail, toast]);

  const doCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setNewBusy(true);
    try {
      const wf = await workflowCreate(newEmptyWorkflow(name, newDescription));
      toast.show({ type: 'success', title: 'Workflow created', message: wf.name });
      setNewOpen(false);
      setNewName('');
      setNewDescription('');
      await loadList();
      setSelectedId(wf.id);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setNewBusy(false);
    }
  }, [newName, newDescription, loadList, toast]);

  const doGenerate = useCallback(async () => {
    const desc = genDescription.trim();
    if (!desc) return;
    setGenBusy(true);
    try {
      const generated = await workflowGenerateFromDescription(desc);
      // Preview in same Dialog per D-176 (explicit Save step after preview).
      setGenPreview(generated);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Generate failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenBusy(false);
    }
  }, [genDescription, toast]);

  const doGenerateSave = useCallback(async () => {
    if (!genPreview) return;
    setGenSaveBusy(true);
    try {
      // The generator may return a Workflow with id already set; blank it so
      // workflow_create treats it as a new record (Rust assigns new uuid).
      const candidate: Workflow = { ...genPreview, id: '', created_at: 0 };
      const wf = await workflowCreate(candidate);
      toast.show({
        type: 'success',
        title: 'Generated workflow saved',
        message: wf.name,
      });
      setGenOpen(false);
      setGenPreview(null);
      setGenDescription('');
      await loadList();
      setSelectedId(wf.id);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenSaveBusy(false);
    }
  }, [genPreview, loadList, toast]);

  const handleDeleted = useCallback(async () => {
    setSelectedId(null);
    setSelected(null);
    setRuns([]);
    await loadList();
  }, [loadList]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="workflow-builder-root">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--s-2)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            color: 'var(--t-1)',
            margin: 0,
          }}
        >
          Workflows
        </h2>
        <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={doRunNow}
            disabled={!selectedId || runBusy}
            data-testid="workflow-run-button"
          >
            {runBusy ? 'Running…' : 'Run now'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setNewOpen(true)}
            data-testid="workflow-new-button"
          >
            New workflow
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGenPreview(null);
              setGenDescription('');
              setGenOpen(true);
            }}
            data-testid="workflow-generate-button"
          >
            Generate from description
          </Button>
        </div>
      </div>

      <div className="workflow-layout">
        <aside
          className="workflow-sidebar"
          aria-label="Workflows list"
          data-testid="workflow-sidebar"
        >
          <div className="workflow-sidebar-header">
            <span style={{ color: 'var(--t-3)', fontSize: 12 }}>
              {listLoading
                ? 'Loading…'
                : `${list.length} workflow${list.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {!listLoading && list.length === 0 && (
            <div className="workflow-empty-state">
              No workflows yet. Click "New workflow" above.
            </div>
          )}
          {list.map((w) => {
            const wRuns = runsByWorkflow[w.id] ?? [];
            const latestStatus = summarizeRunStatus(wRuns);
            return (
              <div
                key={w.id}
                className="workflow-sidebar-row"
                data-selected={selectedId === w.id}
                data-testid="workflow-sidebar-row"
                onClick={() => setSelectedId(w.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(w.id);
                  }
                }}
              >
                <div className="workflow-sidebar-row-name">{w.name}</div>
                <div className="workflow-sidebar-row-meta">
                  <span
                    className="workflow-status-chip"
                    data-status={latestStatus === 'success' ? 'success' : latestStatus === 'failed' ? 'failed' : latestStatus === 'running' ? 'running' : undefined}
                  >
                    {latestStatus}
                  </span>
                  <span>{w.run_count} run{w.run_count === 1 ? '' : 's'}</span>
                </div>
              </div>
            );
          })}
        </aside>

        <div style={{ minHeight: 0 }}>
          {!selectedId && (
            <div className="workflow-empty-state">
              Select a workflow from the sidebar, or create a new one.
            </div>
          )}
          {selectedId && detailLoading && (
            <div className="dev-placeholder-hint">Loading workflow…</div>
          )}
          {selectedId && !detailLoading && !selected && (
            <div className="workflow-empty-state">Workflow not found.</div>
          )}
          {selectedId && !detailLoading && selected && (
            <WorkflowDetail
              workflow={selected}
              runs={runs}
              onRefresh={() => {
                void loadDetail(selected.id);
                void loadList();
              }}
              onDeleted={handleDeleted}
            />
          )}
        </div>
      </div>

      {/* New workflow Dialog */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} ariaLabel="New workflow">
        <h3 className="dialog-title">New workflow</h3>
        <div className="dialog-body">
          <label>
            Name
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Morning briefing"
              aria-label="Workflow name"
              data-testid="workflow-new-name"
            />
          </label>
          <label>
            Description
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What does this workflow do?"
            />
          </label>
          <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>
            Creates an empty workflow. Add steps later from the detail pane.
          </p>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={newBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doCreate}
            disabled={newBusy || !newName.trim()}
            data-testid="workflow-new-create"
          >
            {newBusy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Dialog>

      {/* Generate-from-description Dialog with explicit save step (D-176) */}
      <Dialog
        open={genOpen}
        onClose={() => {
          setGenOpen(false);
          setGenPreview(null);
        }}
        ariaLabel="Generate workflow"
      >
        <h3 className="dialog-title">Generate workflow from description</h3>
        <div className="dialog-body">
          {!genPreview && (
            <>
              <label>
                Description
                <textarea
                  value={genDescription}
                  onChange={(e) => setGenDescription(e.target.value)}
                  placeholder="Every morning at 8am, fetch news, summarize, and email the digest."
                  data-testid="workflow-generate-description"
                />
              </label>
              <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>
                Claude will generate a workflow. You'll review the steps before saving.
              </p>
            </>
          )}
          {genPreview && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--s-1)',
                }}
              >
                <strong style={{ color: 'var(--t-1)' }}>{genPreview.name}</strong>
                {genPreview.description && (
                  <p style={{ color: 'var(--t-3)', margin: 0, fontSize: 12 }}>
                    {genPreview.description}
                  </p>
                )}
                <div style={{ color: 'var(--t-3)', fontSize: 12 }}>
                  {genPreview.nodes.length} step{genPreview.nodes.length === 1 ? '' : 's'}
                </div>
              </div>
              <pre
                className="workflow-step-config"
                style={{ maxHeight: 260 }}
                data-testid="workflow-generate-preview"
              >
                {JSON.stringify(genPreview.nodes, null, 2)}
              </pre>
              <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>
                Review the steps above. Click "Save as new workflow" to persist, or
                "Discard" to try again.
              </p>
            </>
          )}
        </div>
        <div className="dialog-actions">
          {!genPreview && (
            <>
              <Button
                variant="ghost"
                onClick={() => setGenOpen(false)}
                disabled={genBusy}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={doGenerate}
                disabled={genBusy || !genDescription.trim()}
                data-testid="workflow-generate-submit"
              >
                {genBusy ? 'Generating…' : 'Generate preview'}
              </Button>
            </>
          )}
          {genPreview && (
            <>
              <Button
                variant="ghost"
                onClick={() => setGenPreview(null)}
                disabled={genSaveBusy}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={doGenerateSave}
                disabled={genSaveBusy}
                data-testid="workflow-generate-save"
              >
                {genSaveBusy ? 'Saving…' : 'Save as new workflow'}
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </GlassPanel>
  );
}
