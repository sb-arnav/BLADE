// src/features/hive/TentacleDetail.tsx — HIVE-02.
//
// Drill-in for a single tentacle. Reads prefs.hive.activeTentacle, fetches
// hiveGetStatus + hiveGetReports filtered by tentacle id, spawns tentacles via
// hiveSpawnTentacle (Dialog-gated), and surfaces per-organ autonomy sliders
// backed by organGetAutonomy / organSetAutonomy (Dialog-gated for level >= 4).
//
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 1)
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-204, §D-195
// @see .planning/REQUIREMENTS.md §HIVE-02

import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, GlassPanel, Input, Pill, EmptyState } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { TentacleErrorPayload } from '@/lib/events';
import {
  hiveGetReports,
  hiveGetStatus,
  hiveSpawnTentacle,
} from '@/lib/tauri/hive';
import type {
  HiveStatus,
  Priority,
  TentacleReport,
  TentacleSummary,
} from '@/lib/tauri/hive';
import { organGetAutonomy, organSetAutonomy } from '@/lib/tauri/body';
import { useRouterCtx } from '@/windows/main/useRouter';
import './hive.css';

// Planner-picked common actions surfaced in the side panel (D-204 subset).
const ORGAN_ACTIONS = ['send_message', 'post_reply', 'read_feed'] as const;
type OrganAction = (typeof ORGAN_ACTIONS)[number];

function priorityTone(p: Priority): 'default' | 'free' | 'new' | 'pro' {
  switch (p) {
    case 'Critical':
      return 'new';
    case 'High':
      return 'new';
    case 'Normal':
      return 'pro';
    case 'Low':
      return 'default';
  }
}

function relTime(epoch: number): string {
  if (!epoch) return 'never';
  const delta = Math.max(0, Date.now() / 1000 - epoch);
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function TentacleDetail() {
  const router = useRouterCtx();
  const { prefs } = usePrefs();
  const toast = useToast();
  const active = (prefs['hive.activeTentacle'] as string | undefined) ?? 'github';

  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [reports, setReports] = useState<TentacleReport[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<TentacleReport | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnPlatform, setSpawnPlatform] = useState(active);
  const [spawnConfig, setSpawnConfig] = useState('{}');
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [spawnBusy, setSpawnBusy] = useState(false);

  const [autonomy, setAutonomy] = useState<Record<OrganAction, number>>({
    send_message: 0,
    post_reply: 0,
    read_feed: 0,
  });
  const [autonomyBusy, setAutonomyBusy] = useState<OrganAction | null>(null);
  const [autonomyConfirm, setAutonomyConfirm] = useState<{
    action: OrganAction;
    level: number;
  } | null>(null);

  const refresh = () => {
    hiveGetStatus().then(setStatus).catch((e) => setLoadError(String(e)));
    hiveGetReports().then(setReports).catch((e) => setLoadError(String(e)));
  };

  useEffect(() => {
    refresh();
    setSpawnPlatform(active);
    // Load autonomy in parallel, tolerant of unknown-action errors.
    Promise.allSettled(
      ORGAN_ACTIONS.map((a) => organGetAutonomy({ organ: active, action: a })),
    ).then((results) => {
      const next: Record<OrganAction, number> = {
        send_message: 0,
        post_reply: 0,
        read_feed: 0,
      };
      ORGAN_ACTIONS.forEach((a, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') next[a] = r.value;
      });
      setAutonomy(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useTauriEvent<TentacleErrorPayload>(BLADE_EVENTS.TENTACLE_ERROR, (e) => {
    if (!e.payload) return;
    if (e.payload.platform === active || e.payload.tentacle_id.endsWith(active)) {
      refresh();
    }
  });

  const tentacle: TentacleSummary | null = useMemo(() => {
    if (!status) return null;
    return (
      status.tentacles.find((t) => t.platform === active) ??
      status.tentacles.find((t) => t.id === `tentacle-${active}`) ??
      null
    );
  }, [status, active]);

  const filteredReports = useMemo(() => {
    if (!tentacle) return [];
    return reports
      .filter((r) => r.tentacle_id === tentacle.id)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [reports, tentacle]);

  const onAutonomyChange = (action: OrganAction, level: number) => {
    setAutonomy((prev) => ({ ...prev, [action]: level }));
    if (level >= 4) {
      setAutonomyConfirm({ action, level });
    } else {
      commitAutonomy(action, level);
    }
  };

  const commitAutonomy = async (action: OrganAction, level: number) => {
    setAutonomyBusy(action);
    try {
      await organSetAutonomy({ organ: active, action, level });
      toast.show({
        type: 'success',
        title: `Autonomy ${action} → ${level}`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Set autonomy failed',
        message: String(err),
      });
    } finally {
      setAutonomyBusy(null);
      setAutonomyConfirm(null);
    }
  };

  const onSpawn = async () => {
    setSpawnError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(spawnConfig);
    } catch (e) {
      setSpawnError(`Invalid JSON: ${String(e)}`);
      return;
    }
    if (!spawnPlatform.trim()) {
      setSpawnError('Platform is required');
      return;
    }
    setSpawnBusy(true);
    try {
      await hiveSpawnTentacle({ platform: spawnPlatform.trim(), config: parsed });
      toast.show({
        type: 'success',
        title: 'Tentacle spawned',
        message: spawnPlatform.trim(),
      });
      setSpawnOpen(false);
      refresh();
    } catch (err) {
      setSpawnError(String(err));
    } finally {
      setSpawnBusy(false);
    }
  };

  if (loadError) {
    return (
      <GlassPanel className="tentacle-detail" data-testid="hive-tentacle-root">
        <h2 style={{ margin: 0 }}>Tentacle {active}</h2>
        <p style={{ color: 'var(--status-error)' }}>Failed to load: {loadError}</p>
        <Button variant="ghost" onClick={() => router.openRoute('hive-mesh')}>
          Back to Hive
        </Button>
      </GlassPanel>
    );
  }

  if (!status) {
    return (
      <GlassPanel className="tentacle-detail" data-testid="hive-tentacle-root">
        <p>Loading tentacle…</p>
      </GlassPanel>
    );
  }

  if (!tentacle) {
    return (
      <GlassPanel className="tentacle-detail" data-testid="hive-tentacle-root">
        <h2 style={{ margin: 0 }}>No tentacle "{active}"</h2>
        <p style={{ color: 'var(--t-2)' }}>
          The tentacle couldn't be found in the current hive status. It may not
          be spawned yet.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <Button onClick={() => setSpawnOpen(true)}>Spawn {active}</Button>
          <Button variant="ghost" onClick={() => router.openRoute('hive-mesh')}>
            Back to Hive
          </Button>
        </div>

        <Dialog open={spawnOpen} onClose={() => setSpawnOpen(false)} ariaLabel="Spawn tentacle">
          <h3 style={{ margin: 0 }}>Spawn tentacle</h3>
          <div className="tentacle-spawn-form">
            <label>
              Platform
              <Input value={spawnPlatform} onChange={(e) => setSpawnPlatform(e.target.value)} />
            </label>
            <label>
              Config (JSON)
              <textarea
                className="input mono"
                rows={6}
                value={spawnConfig}
                onChange={(e) => setSpawnConfig(e.target.value)}
                placeholder="{}"
              />
            </label>
            {spawnError && <Pill tone="new">{spawnError}</Pill>}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setSpawnOpen(false)} disabled={spawnBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSpawn} disabled={spawnBusy}>
              {spawnBusy ? 'Spawning…' : 'Spawn'}
            </Button>
          </div>
        </Dialog>
      </GlassPanel>
    );
  }

  return (
    <div className="tentacle-detail" data-testid="hive-tentacle-root">
      <div className="tentacle-detail-main">
        <GlassPanel className="tentacle-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{tentacle.platform}</h2>
            <Pill
              tone={tentacle.status === 'Active' ? 'free' : tentacle.status === 'Error' ? 'new' : 'default'}
              dot
            >
              {tentacle.status}
            </Pill>
            <Pill>→ {tentacle.head}</Pill>
            <Button variant="ghost" onClick={() => router.openRoute('hive-mesh')}>
              ← Back
            </Button>
          </div>
          <div className="tentacle-stats">
            <div><strong>{tentacle.messages_processed}</strong><span>messages</span></div>
            <div><strong>{tentacle.actions_taken}</strong><span>actions</span></div>
            <div><strong>{tentacle.pending_report_count}</strong><span>pending</span></div>
            <div><strong>{relTime(tentacle.last_heartbeat)}</strong><span>heartbeat</span></div>
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button onClick={() => setSpawnOpen(true)}>Spawn / reconfigure</Button>
          </div>
        </GlassPanel>

        <GlassPanel className="tentacle-reports">
          <h3 style={{ margin: 0 }}>Reports ({filteredReports.length})</h3>
          {filteredReports.length === 0 ? (
            <EmptyState
              label="This tentacle is still learning"
              description="Reports will appear after 24h of observed activity — give me a day."
            />
          ) : (
            <ul className="tentacle-report-list">
              {filteredReports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="tentacle-report-row"
                    onClick={() => setSelectedReport(r)}
                    data-testid={`report-row-${r.id}`}
                  >
                    <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>
                    <div className="tentacle-report-main">
                      <div className="tentacle-report-summary">{r.summary}</div>
                      <div className="tentacle-report-meta">
                        <span>{r.category}</span>
                        <span>·</span>
                        <span>{relTime(r.timestamp)}</span>
                        {r.requires_action && (
                          <>
                            <span>·</span>
                            <Pill tone="new">action needed</Pill>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="tentacle-side">
        <h3 style={{ margin: 0 }}>Per-action autonomy</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 12, marginTop: 'var(--space-2)' }}>
          0 = ask always · 3 = confident acts · 5 = full autonomy
        </p>
        <div className="tentacle-autonomy-list">
          {ORGAN_ACTIONS.map((a) => (
            <div key={a} className="tentacle-autonomy-row">
              <label htmlFor={`autonomy-${a}`} style={{ fontSize: 13 }}>
                {a}
              </label>
              <input
                id={`autonomy-${a}`}
                type="range"
                min={0}
                max={5}
                step={1}
                value={autonomy[a]}
                onChange={(e) => onAutonomyChange(a, parseInt(e.target.value, 10))}
                disabled={autonomyBusy === a}
                aria-label={`Autonomy for ${a}`}
              />
              <span className="tentacle-autonomy-value">{autonomy[a]}</span>
            </div>
          ))}
        </div>
      </GlassPanel>

      <Dialog
        open={selectedReport !== null}
        onClose={() => setSelectedReport(null)}
        ariaLabel="Report details"
      >
        {selectedReport && (
          <>
            <h3 style={{ margin: 0 }}>{selectedReport.summary}</h3>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Pill tone={priorityTone(selectedReport.priority)}>{selectedReport.priority}</Pill>
              <Pill>{selectedReport.category}</Pill>
              {selectedReport.suggested_action && (
                <Pill tone="pro">Suggested: {selectedReport.suggested_action}</Pill>
              )}
            </div>
            <pre className="decision-details" style={{ marginTop: 'var(--space-3)' }}>
              {JSON.stringify(selectedReport.details, null, 2)}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
              <Button variant="ghost" onClick={() => setSelectedReport(null)}>Close</Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={spawnOpen}
        onClose={() => setSpawnOpen(false)}
        ariaLabel="Spawn tentacle"
      >
        <h3 style={{ margin: 0 }}>Spawn / reconfigure tentacle</h3>
        <div className="tentacle-spawn-form">
          <label>
            Platform
            <Input value={spawnPlatform} onChange={(e) => setSpawnPlatform(e.target.value)} />
          </label>
          <label>
            Config (JSON)
            <textarea
              className="input mono"
              rows={6}
              value={spawnConfig}
              onChange={(e) => setSpawnConfig(e.target.value)}
              placeholder="{}"
            />
          </label>
          {spawnError && <Pill tone="new">{spawnError}</Pill>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" onClick={() => setSpawnOpen(false)} disabled={spawnBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSpawn} disabled={spawnBusy}>
            {spawnBusy ? 'Spawning…' : 'Spawn'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={autonomyConfirm !== null}
        onClose={() => {
          setAutonomyConfirm(null);
          // Revert optimistic change by reloading.
          Promise.allSettled(
            ORGAN_ACTIONS.map((a) => organGetAutonomy({ organ: active, action: a })),
          ).then((results) => {
            const next = { ...autonomy };
            ORGAN_ACTIONS.forEach((a, i) => {
              const r = results[i];
              if (r.status === 'fulfilled') next[a] = r.value;
            });
            setAutonomy(next);
          });
        }}
        ariaLabel="Confirm high autonomy"
      >
        <h3 style={{ margin: 0 }}>
          Raise {autonomyConfirm?.action} autonomy to {autonomyConfirm?.level}?
        </h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Level 4+ lets the tentacle take this action without asking. Confirm?
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" onClick={() => {
            setAutonomyConfirm(null);
            Promise.allSettled(
              ORGAN_ACTIONS.map((a) => organGetAutonomy({ organ: active, action: a })),
            ).then((results) => {
              const next = { ...autonomy };
              ORGAN_ACTIONS.forEach((a, i) => {
                const r = results[i];
                if (r.status === 'fulfilled') next[a] = r.value;
              });
              setAutonomy(next);
            });
          }}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              autonomyConfirm &&
              commitAutonomy(autonomyConfirm.action, autonomyConfirm.level)
            }
            disabled={autonomyBusy !== null}
          >
            {autonomyBusy !== null ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
