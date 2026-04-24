// src/features/life-os/AccountabilityView.tsx — Phase 6 Plan 06-04 (LIFE-09).
//
// Daily plan banner + today's actions checklist + objectives list with KR
// progress bars + create-objective / check-in / progress-report Dialogs. All
// IPC flows through Plan 06-02 life_os.ts wrappers — no raw invoke.
//
// Wrapper signature alignment (discovered in 06-02-SUMMARY):
//   - `accountabilityGetObjectives()` returns `Array<Record<string, unknown>>`
//     (Rust emits serde_json::Value); we coerce each entry into an Objective
//     shape at render time.
//   - `accountabilityUpdateKr({krId, currentValue})` — NOT `{objective_id,
//     kr_id, value}` from the draft.
//   - `accountabilityCompleteAction(actionId)` — direct string argument.
//   - `accountabilityCheckin(...)` — requires mood/energy/win/blocker/tomorrow
//     (NOT `{note}` from the draft).
//   - `accountabilityCreateObjective({title, description, timeframe,
//     durationDays})` — no inline KR list at creation time.
//   - `accountabilityProgressReport(period)` — requires period string.
//
// Optimistic complete (T-06-04-05): mark done immediately; revert + toast on
// error.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-152
// @see .planning/phases/06-life-os-identity/06-04-PLAN.md Task 2
// @see .planning/REQUIREMENTS.md §LIFE-09

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  accountabilityCheckin,
  accountabilityCompleteAction,
  accountabilityCreateObjective,
  accountabilityDailyPlan,
  accountabilityGetDailyActions,
  accountabilityGetObjectives,
  accountabilityProgressReport,
  accountabilityUpdateKr,
} from '@/lib/tauri/life_os';
import type {
  DailyAction,
  DailyPlan,
  KeyResult,
  Objective,
  ProgressReport,
} from './types';
import './life-os.css';
import './life-os-rich-b.css';

/**
 * The Rust `accountability_get_objectives` command emits serde_json::Value
 * entries; we coerce to the Objective shape with best-effort field access.
 */
function coerceObjective(raw: Record<string, unknown>): Objective {
  const keyResults = Array.isArray(raw.key_results)
    ? (raw.key_results as Array<Record<string, unknown>>).map(coerceKeyResult)
    : [];
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    timeframe: String(raw.timeframe ?? ''),
    start_date: String(raw.start_date ?? ''),
    end_date: String(raw.end_date ?? ''),
    status: String(raw.status ?? 'active'),
    key_results: keyResults,
    created_at: typeof raw.created_at === 'number' ? raw.created_at : 0,
    ...raw,
  };
}

function coerceKeyResult(raw: Record<string, unknown>): KeyResult {
  return {
    id: String(raw.id ?? ''),
    objective_id: String(raw.objective_id ?? ''),
    title: String(raw.title ?? ''),
    metric: String(raw.metric ?? ''),
    target_value: typeof raw.target_value === 'number' ? raw.target_value : 0,
    current_value: typeof raw.current_value === 'number' ? raw.current_value : 0,
    unit: String(raw.unit ?? ''),
    status: String(raw.status ?? 'active'),
    last_updated: typeof raw.last_updated === 'number' ? raw.last_updated : 0,
    ...raw,
  };
}

function krProgressPct(kr: KeyResult): number {
  if (!kr.target_value || kr.target_value === 0) return 0;
  const pct = (kr.current_value / kr.target_value) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function AccountabilityView() {
  const { show } = useToast();

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [dailyActions, setDailyActions] = useState<DailyAction[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create-objective form state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createTimeframe, setCreateTimeframe] = useState('quarter');
  const [createDuration, setCreateDuration] = useState(90);
  const [createBusy, setCreateBusy] = useState(false);

  // Update-KR Dialog state.
  const [krDialogOpen, setKrDialogOpen] = useState(false);
  const [krEditing, setKrEditing] = useState<KeyResult | null>(null);
  const [krNewValue, setKrNewValue] = useState('');
  const [krBusy, setKrBusy] = useState(false);

  // Checkin Dialog state.
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinMood, setCheckinMood] = useState(7);
  const [checkinEnergy, setCheckinEnergy] = useState(7);
  const [checkinWin, setCheckinWin] = useState('');
  const [checkinBlocker, setCheckinBlocker] = useState('');
  const [checkinTomorrow, setCheckinTomorrow] = useState('');
  const [checkinBusy, setCheckinBusy] = useState(false);

  // Progress report Dialog state.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportResult, setReportResult] = useState<ProgressReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rawObjs, plan, actions] = await Promise.all([
        accountabilityGetObjectives(),
        accountabilityDailyPlan().catch(() => null),
        accountabilityGetDailyActions(),
      ]);
      setObjectives(rawObjs.map((r) => coerceObjective(r)));
      setDailyPlan(plan);
      setDailyActions(actions);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalKrs = useMemo(
    () => objectives.reduce((acc, o) => acc + o.key_results.length, 0),
    [objectives],
  );

  // Optimistic action toggle (T-06-04-05 mitigation).
  const handleToggleAction = async (actionId: string) => {
    // Find the current state.
    const target = dailyActions.find((a) => a.id === actionId);
    if (!target) return;
    // Only support toggling pending → completed (backend is one-way).
    if (target.completed) return;

    // Optimistic update.
    setDailyActions((prev) =>
      prev.map((a) =>
        a.id === actionId
          ? { ...a, completed: true, completed_at: Math.floor(Date.now() / 1000) }
          : a,
      ),
    );

    try {
      await accountabilityCompleteAction(actionId);
      show({ type: 'success', title: 'Action complete' });
    } catch (e) {
      // Revert on failure.
      setDailyActions((prev) =>
        prev.map((a) =>
          a.id === actionId
            ? { ...a, completed: false, completed_at: null }
            : a,
        ),
      );
      show({ type: 'error', title: 'Complete failed', message: String(e) });
    }
  };

  const handleCreate = async () => {
    const title = createTitle.trim();
    if (!title) return;
    setCreateBusy(true);
    try {
      await accountabilityCreateObjective({
        title,
        description: createDesc.trim(),
        timeframe: createTimeframe,
        durationDays: createDuration,
      });
      show({ type: 'success', title: 'Objective created', message: title });
      setCreateOpen(false);
      setCreateTitle('');
      setCreateDesc('');
      setCreateDuration(90);
      await load();
    } catch (e) {
      show({ type: 'error', title: 'Create failed', message: String(e) });
    } finally {
      setCreateBusy(false);
    }
  };

  const openKrDialog = (kr: KeyResult) => {
    setKrEditing(kr);
    setKrNewValue(String(kr.current_value));
    setKrDialogOpen(true);
  };

  const handleUpdateKr = async () => {
    if (!krEditing) return;
    const value = Number(krNewValue);
    if (!Number.isFinite(value)) {
      show({ type: 'error', title: 'Invalid value', message: 'Enter a number' });
      return;
    }
    setKrBusy(true);
    try {
      await accountabilityUpdateKr({ krId: krEditing.id, currentValue: value });
      show({ type: 'success', title: 'KR updated' });
      setKrDialogOpen(false);
      setKrEditing(null);
      await load();
    } catch (e) {
      show({ type: 'error', title: 'Update failed', message: String(e) });
    } finally {
      setKrBusy(false);
    }
  };

  const handleCheckin = async () => {
    setCheckinBusy(true);
    try {
      await accountabilityCheckin({
        mood: checkinMood,
        energy: checkinEnergy,
        win: checkinWin.trim(),
        blocker: checkinBlocker.trim(),
        tomorrow: checkinTomorrow.trim(),
      });
      show({ type: 'success', title: 'Check-in recorded' });
      setCheckinOpen(false);
      setCheckinWin('');
      setCheckinBlocker('');
      setCheckinTomorrow('');
    } catch (e) {
      show({ type: 'error', title: 'Check-in failed', message: String(e) });
    } finally {
      setCheckinBusy(false);
    }
  };

  const handleReport = async () => {
    setReportBusy(true);
    setReportResult(null);
    setReportOpen(true);
    try {
      const r = await accountabilityProgressReport('week');
      setReportResult(r);
    } catch (e) {
      show({ type: 'error', title: 'Report failed', message: String(e) });
      setReportResult(null);
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="accountability-view-root">
      <div className="accountability-header">
        <h2>Accountability</h2>
        <div className="accountability-header-actions">
          <Button variant="secondary" size="sm" onClick={() => setCheckinOpen(true)}>
            Check in
          </Button>
          <Button variant="secondary" size="sm" onClick={handleReport}>
            Progress report
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            New objective
          </Button>
        </div>
      </div>

      {loading && <GlassSpinner />}
      {loadError && !loading && (
        <p className="life-placeholder-hint">Error: {loadError}</p>
      )}

      {!loading && !loadError && (
        <div className="accountability-layout">
          {/* ─────────── Daily plan banner ──────────── */}
          {dailyPlan && (
            <div className="accountability-daily-banner">
              <div className="accountability-daily-banner-title">
                Today — {dailyPlan.date}
              </div>
              {dailyPlan.blade_message && <div>{dailyPlan.blade_message}</div>}
              {dailyPlan.energy_recommendation && (
                <div style={{ color: 'var(--t-3)', fontSize: 12, marginTop: 4 }}>
                  Energy: {dailyPlan.energy_recommendation}
                </div>
              )}
            </div>
          )}

          {/* ─────────── Daily actions checklist ──────────── */}
          <section>
            <p className="social-section-label">
              Today&rsquo;s actions ({dailyActions.length})
            </p>
            {dailyActions.length === 0 ? (
              <EmptyState
                label="BLADE is still learning your commitments"
                description="Events will appear once you make a commitment — ask me to track one in chat."
              />
            ) : (
              <div>
                {dailyActions.map((a) => (
                  <div
                    key={a.id}
                    className="daily-action-row"
                    data-testid="daily-action-row"
                    data-completed={a.completed ? 'true' : 'false'}
                  >
                    <input
                      type="checkbox"
                      className="daily-action-checkbox"
                      checked={a.completed}
                      onChange={() => handleToggleAction(a.id)}
                      aria-label={`Complete: ${a.title}`}
                      disabled={a.completed}
                    />
                    <span className="daily-action-title">{a.title}</span>
                    <span className="daily-action-energy">{a.energy_level}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ─────────── Objectives ──────────── */}
          <section>
            <p className="social-section-label">
              Objectives ({objectives.length}) · {totalKrs} key results
            </p>
            {objectives.length === 0 ? (
              <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
                No objectives yet. Create one to get started.
              </p>
            ) : (
              objectives.map((o) => (
                <div key={o.id} className="objective-card" data-testid="objective-card">
                  <div className="objective-card-header">
                    <h3 className="objective-card-title">{o.title}</h3>
                    <span className="objective-card-timeframe">{o.timeframe}</span>
                  </div>
                  {o.description && <p className="objective-card-desc">{o.description}</p>}

                  {o.key_results.length === 0 ? (
                    <p style={{ color: 'var(--t-3)', fontSize: 12 }}>
                      No key results defined.
                    </p>
                  ) : (
                    o.key_results.map((kr) => (
                      <div key={kr.id} className="kr-row">
                        <span className="kr-label">{kr.title || kr.metric}</span>
                        <span className="kr-value">
                          {kr.current_value} / {kr.target_value} {kr.unit}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openKrDialog(kr)}
                        >
                          Update
                        </Button>
                        <div className="kr-progress-bar">
                          <div
                            className="kr-progress-fill"
                            style={{ width: `${krProgressPct(kr)}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}

                  <div className="objective-progress-summary">
                    Status: {o.status}
                    {o.end_date && <> · ends {o.end_date}</>}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* ─────────── Create-objective Dialog ──────────── */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        ariaLabel="Create objective"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>New objective</h3>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-2)',
            marginTop: 'var(--s-3)',
          }}
        >
          <Input
            placeholder="Title"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            aria-label="Objective title"
          />
          <textarea
            className="social-log-textarea"
            placeholder="Description"
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            aria-label="Objective description"
          />
          <label
            style={{
              color: 'var(--t-2)',
              fontSize: 12,
              display: 'flex',
              gap: 'var(--s-2)',
              alignItems: 'center',
            }}
          >
            Timeframe
            <select
              value={createTimeframe}
              onChange={(e) => setCreateTimeframe(e.target.value)}
              style={{
                background: 'rgba(0,0,0,0.2)',
                color: 'var(--t-1)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--s-1) var(--s-2)',
                fontSize: 13,
              }}
            >
              <option value="week">week</option>
              <option value="month">month</option>
              <option value="quarter">quarter</option>
              <option value="year">year</option>
            </select>
          </label>
          <label
            style={{
              color: 'var(--t-2)',
              fontSize: 12,
              display: 'flex',
              gap: 'var(--s-2)',
              alignItems: 'center',
            }}
          >
            Duration (days)
            <Input
              type="number"
              value={String(createDuration)}
              onChange={(e) => setCreateDuration(Number(e.target.value) || 0)}
              aria-label="Duration in days"
            />
          </label>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--s-4)',
          }}
        >
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={createBusy || !createTitle.trim()}
          >
            {createBusy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Dialog>

      {/* ─────────── Update-KR Dialog ──────────── */}
      <Dialog
        open={krDialogOpen}
        onClose={() => setKrDialogOpen(false)}
        ariaLabel="Update key result"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Update key result</h3>
        {krEditing && (
          <div style={{ marginTop: 'var(--s-2)' }}>
            <p style={{ color: 'var(--t-2)', fontSize: 13 }}>
              {krEditing.title || krEditing.metric}
              <br />
              <span style={{ color: 'var(--t-3)', fontSize: 12 }}>
                Target: {krEditing.target_value} {krEditing.unit}
              </span>
            </p>
            <Input
              type="number"
              value={krNewValue}
              onChange={(e) => setKrNewValue(e.target.value)}
              aria-label="New current value"
            />
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--s-4)',
          }}
        >
          <Button variant="ghost" onClick={() => setKrDialogOpen(false)} disabled={krBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleUpdateKr} disabled={krBusy}>
            {krBusy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Dialog>

      {/* ─────────── Check-in Dialog ──────────── */}
      <Dialog
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        ariaLabel="Daily check-in"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Daily check-in</h3>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-2)',
            marginTop: 'var(--s-3)',
          }}
        >
          <label style={{ color: 'var(--t-2)', fontSize: 12 }}>
            Mood (1-10)
            <Input
              type="number"
              min={1}
              max={10}
              value={String(checkinMood)}
              onChange={(e) => setCheckinMood(Number(e.target.value) || 0)}
              aria-label="Mood score"
            />
          </label>
          <label style={{ color: 'var(--t-2)', fontSize: 12 }}>
            Energy (1-10)
            <Input
              type="number"
              min={1}
              max={10}
              value={String(checkinEnergy)}
              onChange={(e) => setCheckinEnergy(Number(e.target.value) || 0)}
              aria-label="Energy score"
            />
          </label>
          <textarea
            className="social-log-textarea"
            placeholder="Today's win"
            value={checkinWin}
            onChange={(e) => setCheckinWin(e.target.value)}
            aria-label="Today's win"
          />
          <textarea
            className="social-log-textarea"
            placeholder="Today's blocker"
            value={checkinBlocker}
            onChange={(e) => setCheckinBlocker(e.target.value)}
            aria-label="Today's blocker"
          />
          <textarea
            className="social-log-textarea"
            placeholder="Plan for tomorrow"
            value={checkinTomorrow}
            onChange={(e) => setCheckinTomorrow(e.target.value)}
            aria-label="Plan for tomorrow"
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--s-4)',
          }}
        >
          <Button variant="ghost" onClick={() => setCheckinOpen(false)} disabled={checkinBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCheckin} disabled={checkinBusy}>
            {checkinBusy ? 'Saving…' : 'Save check-in'}
          </Button>
        </div>
      </Dialog>

      {/* ─────────── Progress report Dialog ──────────── */}
      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        ariaLabel="Weekly progress report"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Weekly progress report</h3>
        <div style={{ marginTop: 'var(--s-3)', minHeight: 120 }}>
          {reportBusy && <GlassSpinner />}
          {!reportBusy && reportResult && (
            <div className="accountability-report-result">
              <strong style={{ color: 'var(--t-1)' }}>
                Score: {reportResult.score.toFixed(1)} ({reportResult.period})
              </strong>
              {reportResult.wins.length > 0 && (
                <>
                  <div style={{ marginTop: 8, color: 'var(--t-2)' }}>Wins:</div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {reportResult.wins.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              {reportResult.blockers.length > 0 && (
                <>
                  <div style={{ marginTop: 8, color: 'var(--t-2)' }}>Blockers:</div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {reportResult.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </>
              )}
              {reportResult.recommendations.length > 0 && (
                <>
                  <div style={{ marginTop: 8, color: 'var(--t-2)' }}>Recommendations:</div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {reportResult.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {!reportBusy && !reportResult && (
            <p style={{ color: 'var(--t-3)', fontSize: 13 }}>
              No report data available.
            </p>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 'var(--s-4)',
          }}
        >
          <Button variant="ghost" onClick={() => setReportOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
