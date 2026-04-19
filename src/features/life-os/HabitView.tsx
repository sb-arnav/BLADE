// src/features/life-os/HabitView.tsx — Plan 06-03 Task 1 (LIFE-04).
//
// Real body per D-147 — today checklist (habitGetToday) + habit library
// (habitList) + insights (habitInsights) + suggest-design dialog
// (habitSuggestDesign) + inline create form (habitCreate).
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 1
// @see src/lib/tauri/life_os.ts (habit* wrappers)

import { useCallback, useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog, EmptyState, Input, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  habitGetToday,
  habitList,
  habitComplete,
  habitSkip,
  habitInsights,
  habitSuggestDesign,
  habitCreate,
} from '@/lib/tauri/life_os';
import type { Habit, HabitInsight } from './types';
import './life-os.css';
import './life-os-rich-a.css';

type TodayEntry = [Habit, boolean];

const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

export function HabitView() {
  const toast = useToast();

  const [todayList, setTodayList] = useState<TodayEntry[]>([]);
  const [library, setLibrary] = useState<Habit[]>([]);
  const [insights, setInsights] = useState<HabitInsight[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createFrequency, setCreateFrequency] = useState<Frequency>('daily');
  const [createBusy, setCreateBusy] = useState(false);

  // Suggest-design dialog
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestGoal, setSuggestGoal] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestOutput, setSuggestOutput] = useState<string | null>(null);

  // Row-level action busy state keyed by habit id
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([habitGetToday(), habitList(true), habitInsights()]);
    if (results[0].status === 'fulfilled') setTodayList(results[0].value);
    if (results[1].status === 'fulfilled') setLibrary(results[1].value);
    if (results[2].status === 'fulfilled') setInsights(results[2].value);

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some habit data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleComplete = useCallback(
    async (habitId: string) => {
      setRowBusyId(habitId);
      // Optimistic flip
      setTodayList((prev) => prev.map(([h, done]) => (h.id === habitId ? [h, true] : [h, done])));
      try {
        await habitComplete({ habitId });
        toast.show({ type: 'success', title: 'Habit completed' });
        await loadAll();
      } catch (err) {
        // Revert optimistic update
        setTodayList((prev) => prev.map(([h, done]) => (h.id === habitId ? [h, false] : [h, done])));
        toast.show({
          type: 'error',
          title: 'Complete failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRowBusyId(null);
      }
    },
    [toast, loadAll],
  );

  const handleSkip = useCallback(
    async (habitId: string) => {
      setRowBusyId(habitId);
      try {
        await habitSkip({ habitId, reason: 'Skipped from UI' });
        toast.show({ type: 'info', title: 'Habit skipped' });
        await loadAll();
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Skip failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRowBusyId(null);
      }
    },
    [toast, loadAll],
  );

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    try {
      await habitCreate({
        name,
        description: createDescription.trim() || undefined,
        frequency: createFrequency,
      });
      setCreateName('');
      setCreateDescription('');
      setCreateFrequency('daily');
      toast.show({ type: 'success', title: 'Habit created', message: name });
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreateBusy(false);
    }
  }, [createName, createDescription, createFrequency, createBusy, toast, loadAll]);

  const openSuggest = useCallback(() => {
    setSuggestOpen(true);
    setSuggestGoal('');
    setSuggestOutput(null);
  }, []);

  const handleSuggest = useCallback(async () => {
    const goal = suggestGoal.trim();
    if (!goal || suggestBusy) return;
    setSuggestBusy(true);
    setSuggestOutput(null);
    try {
      const out = await habitSuggestDesign(goal);
      setSuggestOutput(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Suggest failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSuggestBusy(false);
    }
  }, [suggestGoal, suggestBusy, toast]);

  const prefillFromSuggestion = useCallback(() => {
    if (!suggestOutput) return;
    // Best-effort: use first non-empty line as the habit name.
    const firstLine = suggestOutput.split('\n').find((l) => l.trim().length > 0) ?? '';
    setCreateName(firstLine.slice(0, 80));
    setCreateDescription(suggestOutput.slice(0, 280));
    setSuggestOpen(false);
  }, [suggestOutput]);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="habits-view-root">
      <div className="health-header">
        <div>
          <h2 className="health-header-title">Habits</h2>
          <div className="health-header-date">
            {todayList.length} today · {library.length} tracked
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={openSuggest}>
          Suggest design
        </Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading habits" />
        </div>
      ) : (
        <>
          <h3 className="life-section-title">Today</h3>
          {todayList.length === 0 ? (
            <div className="life-empty">No habits scheduled for today.</div>
          ) : (
            <div className="habit-rows">
              {todayList.map(([habit, done]) => (
                <div
                  key={habit.id}
                  className="habit-row"
                  data-testid="habit-row"
                  data-completed={done}
                >
                  <div>
                    <div className="habit-row-title">{habit.name}</div>
                    <div className="habit-row-streak">
                      {habit.frequency} · streak {habit.current_streak}
                      {habit.best_streak > habit.current_streak ? ` / best ${habit.best_streak}` : ''}
                    </div>
                  </div>
                  <div className="habit-row-streak">
                    {Math.round((habit.completion_rate ?? 0) * 100)}%
                  </div>
                  <Button
                    variant={done ? 'ghost' : 'primary'}
                    size="sm"
                    onClick={() => void handleComplete(habit.id)}
                    disabled={done || rowBusyId === habit.id}
                  >
                    {done ? 'Done' : 'Complete'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSkip(habit.id)}
                    disabled={done || rowBusyId === habit.id}
                  >
                    Skip
                  </Button>
                </div>
              ))}
            </div>
          )}

          <h3 className="life-section-title">Library</h3>
          <form
            className="habit-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="habit-add-form-field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="habit-add-name">Name</label>
              <Input
                id="habit-add-name"
                type="text"
                placeholder="New habit"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={createBusy}
              />
            </div>
            <div className="habit-add-form-field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="habit-add-description">Description</label>
              <Input
                id="habit-add-description"
                type="text"
                placeholder="What triggers it?"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                disabled={createBusy}
              />
            </div>
            <div className="habit-add-form-field">
              <label htmlFor="habit-add-frequency">Cadence</label>
              <div className="goal-priority-row" id="habit-add-frequency">
                {FREQUENCIES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="goal-priority-row-btn"
                    data-active={createFrequency === f}
                    onClick={() => setCreateFrequency(f)}
                    disabled={createBusy}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!createName.trim() || createBusy}
              >
                {createBusy ? 'Creating…' : 'Create habit'}
              </Button>
            </div>
          </form>

          {library.length === 0 ? (
            <EmptyState
              label="No habits yet"
              description="Add one to build your streak."
              actionLabel="Add habit"
              onAction={() => document.getElementById('habit-add-name')?.focus()}
            />
          ) : (
            <div className="habits-grid">
              {library.map((habit) => (
                <div key={habit.id} className="life-card" data-testid="habit-card">
                  <h3 className="habit-card-title">{habit.name}</h3>
                  {habit.description ? (
                    <p className="habit-card-description">{habit.description}</p>
                  ) : null}
                  <div style={{ color: 'var(--t-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {habit.frequency} · streak {habit.current_streak} · best {habit.best_streak} ·{' '}
                    {Math.round((habit.completion_rate ?? 0) * 100)}% done
                  </div>
                  {habit.cue ? (
                    <div style={{ color: 'var(--t-3)', fontSize: 11 }}>
                      <strong style={{ color: 'var(--t-2)' }}>Cue:</strong> {habit.cue}
                    </div>
                  ) : null}
                  {habit.reward ? (
                    <div style={{ color: 'var(--t-3)', fontSize: 11 }}>
                      <strong style={{ color: 'var(--t-2)' }}>Reward:</strong> {habit.reward}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <h3 className="life-section-title">Insights</h3>
          {insights.length === 0 ? (
            <div className="life-empty">No insights yet — complete a few habits to generate feedback.</div>
          ) : (
            <ul
              className="health-insights-list"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--s-3) var(--s-3) var(--s-3) calc(var(--s-3) + var(--s-4))',
              }}
            >
              {insights.map((it, idx) => (
                <li key={idx}>
                  <strong>{it.habit_name}</strong>
                  {' — '}
                  {it.description}
                  {it.suggestion ? (
                    <>
                      {' · '}
                      <em style={{ color: 'var(--t-3)' }}>{it.suggestion}</em>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        ariaLabel="Suggest a habit design"
      >
        <form
          className="life-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSuggest();
          }}
        >
          <h3 className="life-dialog-heading">Suggest a habit design</h3>
          <label htmlFor="habit-suggest-goal" style={{ color: 'var(--t-2)', fontSize: 13 }}>
            Describe a goal — BLADE will propose a habit loop.
          </label>
          <Input
            id="habit-suggest-goal"
            type="text"
            value={suggestGoal}
            onChange={(e) => setSuggestGoal(e.target.value)}
            placeholder="e.g. Write more consistently"
            disabled={suggestBusy}
            autoFocus
          />
          {suggestBusy ? (
            <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <GlassSpinner size={18} label="Designing" />
              <span style={{ color: 'var(--t-3)', fontSize: 13 }}>Designing…</span>
            </div>
          ) : null}
          {suggestOutput ? (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: 'rgba(255,255,255,0.04)',
                padding: 'var(--s-2)',
                borderRadius: 'var(--r-sm)',
                maxHeight: 280,
                overflowY: 'auto',
                color: 'var(--t-1)',
                margin: 0,
              }}
            >
              {suggestOutput}
            </pre>
          ) : null}
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSuggestOpen(false)}
              disabled={suggestBusy}
            >
              Close
            </Button>
            {suggestOutput ? (
              <Button type="button" variant="secondary" size="sm" onClick={prefillFromSuggestion}>
                Create from suggestion
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!suggestGoal.trim() || suggestBusy}
            >
              {suggestBusy ? 'Designing…' : 'Design habit'}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassPanel>
  );
}
