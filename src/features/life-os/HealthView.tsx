// src/features/life-os/HealthView.tsx — Plan 06-03 Task 1 (LIFE-01).
//
// Real body per D-145 — today's snapshot + streak chip + insights + scan.
// Parallel-fetches 6 wrappers on mount via Promise.allSettled so one failing
// surface doesn't take down the whole view.
//
// SC-1 streak integration: `streakGetStats` + `healthStreakInfo` both feed
// the streak chip. Unit preference (`lifeOs.health.unit`) drives display
// conversion on the sleep / activity / water stats.
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 1
// @see src/lib/tauri/life_os.ts (healthGetToday, healthGetStats, ...)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, EmptyState, GlassSpinner, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  healthGetToday,
  healthGetStats,
  healthGetInsights,
  healthStreakInfo,
  healthScanNow,
  healthGetScan,
  healthUpdateToday,
  healthCorrelateProductivity,
  streakGetStats,
} from '@/lib/tauri/life_os';
import type {
  HealthLog,
  HealthStats,
  HealthInsight,
  ProjectHealth,
  StreakStats,
} from './types';
import './life-os.css';
import './life-os-rich-a.css';

type Unit = 'metric' | 'imperial';

function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function formatScore(value: number | null | undefined, scale = 10): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value}/${scale}`;
}

/** Range classification for colored stat borders. */
function sleepRange(hours: number | null | undefined): 'low' | 'ok' | 'good' | undefined {
  if (hours === null || hours === undefined) return undefined;
  if (hours < 6) return 'low';
  if (hours >= 7.5) return 'good';
  return 'ok';
}

function scoreRange(score: number | null | undefined): 'low' | 'ok' | 'good' | undefined {
  if (score === null || score === undefined) return undefined;
  if (score <= 3) return 'low';
  if (score >= 7) return 'good';
  return 'ok';
}

function formatTimestamp(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

export function HealthView() {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();

  const unit: Unit = (prefs['lifeOs.health.unit'] as Unit) ?? 'metric';

  const [today, setToday] = useState<HealthLog | null>(null);
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [insights, setInsights] = useState<HealthInsight[]>([]);
  const [streakInfo, setStreakInfo] = useState<Record<string, unknown> | null>(null);
  const [streak, setStreak] = useState<StreakStats | null>(null);
  const [scan, setScan] = useState<ProjectHealth | null>(null);
  const [loading, setLoading] = useState(true);

  // Update dialog state
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateSleep, setUpdateSleep] = useState('');
  const [updateActivity, setUpdateActivity] = useState('');
  const [updateMood, setUpdateMood] = useState('');
  const [updateEnergy, setUpdateEnergy] = useState('');
  const [updateQuality, setUpdateQuality] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);

  // Correlate productivity output
  const [correlateOutput, setCorrelateOutput] = useState<string | null>(null);
  const [correlateBusy, setCorrelateBusy] = useState(false);

  // Scan controls
  const [scanBusy, setScanBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      healthGetToday(),
      healthGetStats(7),
      healthGetInsights(14),
      healthStreakInfo(),
      streakGetStats(),
      healthGetScan('blade'),
    ]);

    if (results[0].status === 'fulfilled') setToday(results[0].value);
    if (results[1].status === 'fulfilled') setStats(results[1].value);
    if (results[2].status === 'fulfilled') setInsights(results[2].value);
    if (results[3].status === 'fulfilled') setStreakInfo(results[3].value);
    if (results[4].status === 'fulfilled') setStreak(results[4].value);
    if (results[5].status === 'fulfilled') setScan(results[5].value);

    // Surface first failure via toast for visibility, but don't halt.
    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some health data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }

    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openUpdate = useCallback(() => {
    setUpdateSleep(today?.sleep_hours == null ? '' : String(today.sleep_hours));
    setUpdateActivity(today?.exercise_minutes == null ? '' : String(today.exercise_minutes));
    setUpdateMood(today?.mood == null ? '' : String(today.mood));
    setUpdateEnergy(today?.energy_level == null ? '' : String(today.energy_level));
    setUpdateQuality(today?.sleep_quality == null ? '' : String(today.sleep_quality));
    setUpdateOpen(true);
  }, [today]);

  const handleUpdateSave = useCallback(async () => {
    setUpdateBusy(true);
    try {
      // Rust: health_update_today(updates: serde_json::Value). We pass only
      // fields the user typed so blank inputs don't zero out existing values.
      const updates: Record<string, unknown> = {};
      if (updateSleep.trim() !== '') updates.sleep_hours = Number(updateSleep);
      if (updateActivity.trim() !== '') updates.exercise_minutes = Number(updateActivity);
      if (updateMood.trim() !== '') updates.mood = Number(updateMood);
      if (updateEnergy.trim() !== '') updates.energy_level = Number(updateEnergy);
      if (updateQuality.trim() !== '') updates.sleep_quality = Number(updateQuality);

      // Guard — reject obviously bad numbers before round-tripping to Rust.
      for (const [k, v] of Object.entries(updates)) {
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error(`Invalid number for ${k}`);
        }
      }

      await healthUpdateToday(updates);
      toast.show({ type: 'success', title: 'Today updated' });
      setUpdateOpen(false);
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUpdateBusy(false);
    }
  }, [updateSleep, updateActivity, updateMood, updateEnergy, updateQuality, toast, loadAll]);

  const handleScanNow = useCallback(async () => {
    setScanBusy(true);
    try {
      const result = await healthScanNow({ project: 'blade', rootPath: '.' });
      setScan(result);
      toast.show({
        type: 'success',
        title: 'Scan complete',
        message: `${result.files_scanned} files · ${formatTimestamp(result.scanned_at)}`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Scan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanBusy(false);
    }
  }, [toast]);

  const handleCorrelate = useCallback(async () => {
    setCorrelateBusy(true);
    try {
      const text = await healthCorrelateProductivity(14);
      setCorrelateOutput(text);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Correlation failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCorrelateBusy(false);
    }
  }, [toast]);

  const setUnit = useCallback(
    (u: Unit) => {
      setPref('lifeOs.health.unit', u);
    },
    [setPref],
  );

  // ─── Display conversions ────────────────────────────────────────────
  // Metric → imperial: hours stay, but activity is displayed in hours/minutes regardless.
  // We include a hint for imperial units. Sleep is hours (universal).
  const sleepHours = today?.sleep_hours ?? stats?.avg_sleep ?? null;
  const activityMin = today?.exercise_minutes ?? stats?.total_exercise_minutes ?? null;
  const moodScore = today?.mood ?? (stats?.avg_mood ?? null);
  const energyScore = today?.energy_level ?? (stats?.avg_energy ?? null);
  const qualityScore = today?.sleep_quality ?? null;

  // Streak chip — pull whichever numeric field surfaces first from streakInfo.
  const healthStreak = useMemo(() => {
    if (!streakInfo) return null;
    const cand =
      (streakInfo as { current_streak?: unknown }).current_streak ??
      (streakInfo as { streak?: unknown }).streak ??
      (streakInfo as { days?: unknown }).days;
    return typeof cand === 'number' ? cand : null;
  }, [streakInfo]);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="health-view-root">
      <div className="health-header">
        <div>
          <h2 className="health-header-title">Health</h2>
          <div className="health-header-date">{isoToday()}</div>
        </div>
        <div className="health-unit-toggle" role="group" aria-label="Unit system">
          <button
            type="button"
            className="health-unit-toggle-btn"
            data-active={unit === 'metric'}
            onClick={() => setUnit('metric')}
            aria-pressed={unit === 'metric'}
          >
            Metric
          </button>
          <button
            type="button"
            className="health-unit-toggle-btn"
            data-active={unit === 'imperial'}
            onClick={() => setUnit('imperial')}
            aria-pressed={unit === 'imperial'}
          >
            Imperial
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading health data" />
        </div>
      ) : (
        <>
          <div className="life-stat-grid">
            <div
              className="health-stat"
              data-testid="health-stat"
              data-key="sleep"
              data-range={sleepRange(sleepHours)}
            >
              <span className="health-stat-label">Sleep</span>
              <span className="health-stat-value">{formatHours(sleepHours)}</span>
              {unit === 'imperial' && sleepHours != null ? (
                <span className="health-stat-hint">{sleepHours.toFixed(1)} hrs</span>
              ) : null}
            </div>
            <div
              className="health-stat"
              data-testid="health-stat"
              data-key="activity"
              data-range={scoreRange(activityMin == null ? null : Math.min(10, activityMin / 6))}
            >
              <span className="health-stat-label">Activity</span>
              <span className="health-stat-value">{formatMinutes(activityMin)}</span>
              {unit === 'imperial' && activityMin != null ? (
                <span className="health-stat-hint">{(activityMin / 60).toFixed(1)} hrs</span>
              ) : null}
            </div>
            <div
              className="health-stat"
              data-testid="health-stat"
              data-key="mood"
              data-range={scoreRange(moodScore)}
            >
              <span className="health-stat-label">Mood</span>
              <span className="health-stat-value">{formatScore(moodScore)}</span>
            </div>
            <div
              className="health-stat"
              data-testid="health-stat"
              data-key="energy"
              data-range={scoreRange(energyScore)}
            >
              <span className="health-stat-label">Energy</span>
              <span className="health-stat-value">{formatScore(energyScore)}</span>
            </div>
            <div
              className="health-stat"
              data-testid="health-stat"
              data-key="focus"
              data-range={scoreRange(qualityScore)}
            >
              <span className="health-stat-label">Sleep quality</span>
              <span className="health-stat-value">{formatScore(qualityScore)}</span>
            </div>
          </div>

          <div className="health-toolbar">
            <span className="health-streak-chip" data-testid="health-streak-chip">
              Streak · {healthStreak ?? '—'} day{healthStreak === 1 ? '' : 's'}
              {streak ? ` · ${streak.total_active_days} active days` : ''}
            </span>
            <Button variant="primary" size="sm" onClick={openUpdate}>
              Update today
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void handleScanNow()} disabled={scanBusy}>
              {scanBusy ? 'Scanning…' : 'Scan now'}
            </Button>
            <span className="health-scan-status">
              {scan
                ? `Last scan · ${formatTimestamp(scan.scanned_at)} · ${scan.files_scanned} files`
                : 'No scan yet'}
            </span>
          </div>

          <div className="health-insights" data-testid="health-insights">
            <h3 className="health-insights-title">Insights</h3>
            {insights.length === 0 ? (
              <EmptyState
                label="BLADE is still learning your baseline"
                description="Insights will appear after 24h of observed activity — give me a day."
              />
            ) : (
              <ul className="health-insights-list">
                {insights.map((it, idx) => (
                  <li key={idx}>
                    <span className="health-insight-urgency" data-level={it.urgency}>
                      {it.urgency}
                    </span>
                    <strong>{it.title}</strong>
                    {' — '}
                    {it.description}
                    {it.recommendation ? (
                      <>
                        {' · '}
                        <em style={{ color: 'var(--t-3)' }}>{it.recommendation}</em>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div style={{ marginTop: 'var(--s-3)', display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <Button variant="ghost" size="sm" onClick={() => void handleCorrelate()} disabled={correlateBusy}>
                {correlateBusy ? 'Analyzing…' : 'Correlate with productivity'}
              </Button>
            </div>
            {correlateOutput ? (
              <div className="health-correlate-output" data-testid="health-correlate-output">
                {correlateOutput}
              </div>
            ) : null}
          </div>
        </>
      )}

      <Dialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        ariaLabel="Update today's health log"
      >
        <form
          className="life-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleUpdateSave();
          }}
        >
          <h3 className="life-dialog-heading">Update today</h3>
          <div className="life-dialog-grid">
            <div className="life-dialog-grid-field">
              <label htmlFor="health-update-sleep">Sleep hours</label>
              <Input
                id="health-update-sleep"
                type="number"
                step="0.1"
                min="0"
                max="24"
                value={updateSleep}
                onChange={(e) => setUpdateSleep(e.target.value)}
                mono
                disabled={updateBusy}
              />
            </div>
            <div className="life-dialog-grid-field">
              <label htmlFor="health-update-activity">Exercise minutes</label>
              <Input
                id="health-update-activity"
                type="number"
                step="1"
                min="0"
                max="1440"
                value={updateActivity}
                onChange={(e) => setUpdateActivity(e.target.value)}
                mono
                disabled={updateBusy}
              />
            </div>
            <div className="life-dialog-grid-field">
              <label htmlFor="health-update-mood">Mood (1-10)</label>
              <Input
                id="health-update-mood"
                type="number"
                step="1"
                min="1"
                max="10"
                value={updateMood}
                onChange={(e) => setUpdateMood(e.target.value)}
                mono
                disabled={updateBusy}
              />
            </div>
            <div className="life-dialog-grid-field">
              <label htmlFor="health-update-energy">Energy (1-10)</label>
              <Input
                id="health-update-energy"
                type="number"
                step="1"
                min="1"
                max="10"
                value={updateEnergy}
                onChange={(e) => setUpdateEnergy(e.target.value)}
                mono
                disabled={updateBusy}
              />
            </div>
            <div className="life-dialog-grid-field">
              <label htmlFor="health-update-quality">Sleep quality (1-10)</label>
              <Input
                id="health-update-quality"
                type="number"
                step="1"
                min="1"
                max="10"
                value={updateQuality}
                onChange={(e) => setUpdateQuality(e.target.value)}
                mono
                disabled={updateBusy}
              />
            </div>
          </div>
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setUpdateOpen(false)}
              disabled={updateBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={updateBusy}>
              {updateBusy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassPanel>
  );
}
