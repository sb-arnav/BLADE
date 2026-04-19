// src/features/life-os/GoalView.tsx — Plan 06-03 Task 1 (LIFE-03).
//
// Real body per D-147 — goal list grid with priority pills + "Pursue now"
// button. Inline add form at top; Complete + Delete paths gated through
// Dialog confirm (threat T-06-03-03 mitigation).
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 1
// @see src/lib/tauri/life_os.ts (goal* wrappers)

import { useCallback, useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog, EmptyState, Input, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  goalList,
  goalAdd,
  goalComplete,
  goalDelete,
  goalUpdatePriority,
  goalPursueNow,
} from '@/lib/tauri/life_os';
import type { Goal } from './types';
import './life-os.css';
import './life-os-rich-a.css';

const PRIORITY_LEVELS: { label: string; value: number }[] = [
  { label: 'Low', value: 1 },
  { label: 'Normal', value: 2 },
  { label: 'High', value: 4 },
];

function priorityLabel(p: number): string {
  if (p <= 1) return 'Low';
  if (p <= 2) return 'Normal';
  return 'High';
}

export function GoalView() {
  const toast = useToast();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const [addTitle, setAddTitle] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [addPriority, setAddPriority] = useState(2);
  const [addBusy, setAddBusy] = useState(false);

  const [pursueBusyId, setPursueBusyId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await goalList();
      setGoals(rows);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Could not load goals',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = useCallback(async () => {
    const title = addTitle.trim();
    if (!title || addBusy) return;
    setAddBusy(true);
    try {
      await goalAdd({
        title,
        description: addDescription.trim() || title,
        priority: addPriority,
      });
      setAddTitle('');
      setAddDescription('');
      setAddPriority(2);
      toast.show({ type: 'success', title: 'Goal created', message: title });
      await load();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAddBusy(false);
    }
  }, [addTitle, addDescription, addPriority, addBusy, toast, load]);

  const handlePursue = useCallback(
    async (id: string) => {
      setPursueBusyId(id);
      try {
        const result = await goalPursueNow(id);
        toast.show({
          type: 'success',
          title: 'Pursuing',
          message: result.slice(0, 160),
        });
        await load();
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Pursue failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPursueBusyId(null);
      }
    },
    [toast, load],
  );

  const handlePriorityChange = useCallback(
    async (id: string, priority: number) => {
      try {
        await goalUpdatePriority({ id, priority });
        setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, priority } : g)));
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Priority change failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const handleComplete = useCallback(async () => {
    const id = completeId;
    if (!id) return;
    try {
      await goalComplete(id);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      toast.show({ type: 'success', title: 'Goal completed' });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Complete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCompleteId(null);
    }
  }, [completeId, toast]);

  const handleDelete = useCallback(async () => {
    const id = deleteId;
    if (!id) return;
    try {
      await goalDelete(id);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      toast.show({ type: 'success', title: 'Goal deleted' });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleteId(null);
    }
  }, [deleteId, toast]);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="goals-view-root">
      <div className="health-header">
        <div>
          <h2 className="health-header-title">Goals</h2>
          <div className="health-header-date">
            {goals.length} active goal{goals.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <form
        className="goal-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
      >
        <div className="goal-add-form-field" style={{ flex: '2 1 320px' }}>
          <label htmlFor="goal-add-title">Title</label>
          <Input
            id="goal-add-title"
            type="text"
            placeholder="What do you want to achieve?"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            disabled={addBusy}
          />
        </div>
        <div className="goal-add-form-field" style={{ flex: '2 1 320px' }}>
          <label htmlFor="goal-add-description">Description (optional)</label>
          <Input
            id="goal-add-description"
            type="text"
            placeholder="Why does this matter?"
            value={addDescription}
            onChange={(e) => setAddDescription(e.target.value)}
            disabled={addBusy}
          />
        </div>
        <div className="goal-add-form-field">
          <label htmlFor="goal-add-priority">Priority</label>
          <div className="goal-priority-row" id="goal-add-priority">
            {PRIORITY_LEVELS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="goal-priority-row-btn"
                data-active={addPriority === opt.value}
                onClick={() => setAddPriority(opt.value)}
                disabled={addBusy}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <Button type="submit" variant="primary" size="sm" disabled={!addTitle.trim() || addBusy}>
            {addBusy ? 'Creating…' : 'Add goal'}
          </Button>
        </div>
      </form>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading goals" />
        </div>
      ) : goals.length === 0 ? (
        <EmptyState
          label="No goals yet"
          description="Add one to start tracking progress."
          actionLabel="Add goal"
          onAction={() => document.getElementById('goal-add-title')?.focus()}
        />
      ) : (
        <div className="goals-grid">
          {goals.map((g) => (
            <div
              key={g.id}
              className="life-card"
              data-testid="goal-card"
              data-priority={g.priority}
              data-status={g.status === 'completed' ? 'complete' : g.status === 'blocked' ? 'failed' : 'running'}
            >
              <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="goal-card-title">{g.title}</h3>
                <span className="goal-priority-pill" data-priority={g.priority}>
                  {priorityLabel(g.priority)}
                </span>
              </div>
              {g.description ? <p className="goal-card-description">{g.description}</p> : null}
              <div style={{ color: 'var(--t-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                {g.status} · {g.attempts} attempt{g.attempts === 1 ? '' : 's'}
                {g.subtasks && g.subtasks.length > 0 ? ` · ${g.subtasks.length} subtasks` : ''}
              </div>
              <div className="goal-priority-row">
                {PRIORITY_LEVELS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="goal-priority-row-btn"
                    data-active={g.priority === opt.value}
                    onClick={() => void handlePriorityChange(g.id, opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="goal-card-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handlePursue(g.id)}
                  disabled={pursueBusyId === g.id}
                >
                  {pursueBusyId === g.id ? 'Pursuing…' : 'Pursue now'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setCompleteId(g.id)}>
                  Complete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(g.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={completeId !== null} onClose={() => setCompleteId(null)} ariaLabel="Confirm complete goal">
        <div className="life-dialog-body">
          <h3 className="life-dialog-heading">Mark this goal complete?</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            The goal will be removed from the active list. You can't undo this from the UI.
          </p>
          <div className="life-dialog-actions">
            <Button variant="ghost" size="sm" onClick={() => setCompleteId(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleComplete()}>
              Complete
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteId !== null} onClose={() => setDeleteId(null)} ariaLabel="Confirm delete goal">
        <div className="life-dialog-body">
          <h3 className="life-dialog-heading">Delete this goal?</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            The goal and its subtasks will be permanently removed.
          </p>
          <div className="life-dialog-actions">
            <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
