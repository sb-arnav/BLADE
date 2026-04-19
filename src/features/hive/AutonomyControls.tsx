// src/features/hive/AutonomyControls.tsx — HIVE-03.
//
// Per-tentacle × per-action autonomy matrix on top of a global-autonomy hero
// slider. 10 tentacles × 6 common actions = 60 cells, each backed by
// organGetAutonomy / organSetAutonomy (Dialog-gated for level >= 4).
// Global row writes via hiveSetAutonomy (Dialog-gated for level >= 0.7).
//
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 2)
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-204
// @see .planning/REQUIREMENTS.md §HIVE-03

import { useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { hiveGetStatus, hiveSetAutonomy } from '@/lib/tauri/hive';
import type { HiveStatus } from '@/lib/tauri/hive';
import { organGetAutonomy, organSetAutonomy } from '@/lib/tauri/body';
import './hive.css';

const COMMON_ACTIONS = [
  'send_message',
  'post_reply',
  'create_issue',
  'trigger_deploy',
  'read_feed',
  'mark_read',
] as const;
type CommonAction = (typeof COMMON_ACTIONS)[number];

const LEVEL_LABELS: Record<number, string> = {
  0: 'ask always',
  1: 'ask high-risk',
  2: 'ask high-risk',
  3: 'confident acts',
  4: 'full autonomy',
  5: 'full autonomy',
};

type Matrix = Record<string, Partial<Record<CommonAction, number | null>>>;

export function AutonomyControls() {
  const toast = useToast();
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [globalConfirm, setGlobalConfirm] = useState<number | null>(null);
  const [cellConfirm, setCellConfirm] = useState<{
    platform: string;
    action: CommonAction;
    level: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    hiveGetStatus()
      .then(async (s) => {
        setStatus(s);
        const pairs: Array<{ platform: string; action: CommonAction }> = [];
        for (const t of s.tentacles) {
          for (const a of COMMON_ACTIONS) {
            pairs.push({ platform: t.platform, action: a });
          }
        }
        const results = await Promise.allSettled(
          pairs.map((p) =>
            organGetAutonomy({ organ: p.platform, action: p.action }),
          ),
        );
        const next: Matrix = {};
        pairs.forEach((p, i) => {
          next[p.platform] ??= {};
          const r = results[i];
          next[p.platform][p.action] =
            r.status === 'fulfilled' ? r.value : null;
        });
        setMatrix(next);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const onGlobalChange = (level: number) => {
    if (!status) return;
    setStatus({ ...status, autonomy: level });
    if (level >= 0.7) {
      setGlobalConfirm(level);
    } else {
      commitGlobal(level);
    }
  };

  const commitGlobal = async (level: number) => {
    setBusy('global');
    try {
      await hiveSetAutonomy({ level });
      toast.show({
        type: 'success',
        title: `Global autonomy ${level.toFixed(2)}`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Set autonomy failed',
        message: String(err),
      });
    } finally {
      setBusy(null);
      setGlobalConfirm(null);
    }
  };

  const onCellChange = (
    platform: string,
    action: CommonAction,
    level: number,
  ) => {
    setMatrix((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], [action]: level },
    }));
    if (level >= 4) {
      setCellConfirm({ platform, action, level });
    } else {
      commitCell(platform, action, level);
    }
  };

  const commitCell = async (
    platform: string,
    action: CommonAction,
    level: number,
  ) => {
    const key = `${platform}-${action}`;
    setBusy(key);
    try {
      await organSetAutonomy({ organ: platform, action, level });
      toast.show({
        type: 'success',
        title: `${platform}.${action} → ${level}`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Set autonomy failed',
        message: String(err),
      });
    } finally {
      setBusy(null);
      setCellConfirm(null);
    }
  };

  if (loadError) {
    return (
      <GlassPanel className="autonomy-controls" data-testid="hive-autonomy-root">
        <h2 style={{ margin: 0 }}>Autonomy Controls</h2>
        <p style={{ color: 'var(--status-error)' }}>Failed to load: {loadError}</p>
      </GlassPanel>
    );
  }

  if (!status) {
    return (
      <GlassPanel className="autonomy-controls" data-testid="hive-autonomy-root">
        <p>Loading autonomy…</p>
      </GlassPanel>
    );
  }

  return (
    <div className="autonomy-controls" data-testid="hive-autonomy-root">
      <GlassPanel className="autonomy-global">
        <h2 style={{ margin: 0 }}>Autonomy Controls</h2>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-1)' }}>
          Top row controls the global hive autonomy (0.0 — 1.0). Matrix below is
          per-tentacle × per-action (0 = ask always, 5 = full autonomy).
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label htmlFor="autonomy-global" style={{ fontSize: 13 }}>
            Global hive autonomy: <strong>{status.autonomy.toFixed(2)}</strong>
          </label>
          <input
            id="autonomy-global"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={status.autonomy}
            onChange={(e) => onGlobalChange(parseFloat(e.target.value))}
            disabled={busy === 'global'}
            style={{ flex: 1, minWidth: 180 }}
            data-testid="global-autonomy-slider"
            aria-label="Global hive autonomy"
          />
          <Pill tone={status.autonomy >= 0.7 ? 'new' : 'default'}>
            {status.autonomy >= 0.7 ? 'high' : status.autonomy >= 0.3 ? 'confident' : 'cautious'}
          </Pill>
        </div>
      </GlassPanel>

      <GlassPanel style={{ padding: 'var(--space-3)' }}>
        <h3 style={{ margin: 0 }}>Per-tentacle × per-action matrix</h3>
        <div className="autonomy-matrix-wrap" style={{ marginTop: 'var(--space-3)' }}>
          <div
            className="autonomy-matrix"
            style={{
              gridTemplateColumns: `160px repeat(${COMMON_ACTIONS.length}, minmax(120px, 1fr))`,
            }}
          >
            <div className="autonomy-cell header">tentacle</div>
            {COMMON_ACTIONS.map((a) => (
              <div key={a} className="autonomy-cell header">{a}</div>
            ))}
            {status.tentacles.map((t) => (
              <div
                key={t.id}
                data-testid={`autonomy-row-${t.platform}`}
                style={{ display: 'contents' }}
              >
                <div className="autonomy-cell label">{t.platform}</div>
                {COMMON_ACTIONS.map((a) => {
                  const v = matrix[t.platform]?.[a];
                  const key = `${t.platform}-${a}`;
                  if (v == null) {
                    return (
                      <div
                        key={a}
                        className="autonomy-cell autonomy-cell-empty"
                        title="No autonomy record"
                      >—</div>
                    );
                  }
                  return (
                    <div key={a} className="autonomy-cell">
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={1}
                        value={v}
                        onChange={(e) =>
                          onCellChange(t.platform, a, parseInt(e.target.value, 10))
                        }
                        disabled={busy === key}
                        title={LEVEL_LABELS[v] ?? ''}
                        aria-label={`Autonomy for ${t.platform} ${a}`}
                      />
                      <span className="autonomy-cell-value">{v} · {LEVEL_LABELS[v]}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </GlassPanel>

      <Dialog
        open={globalConfirm !== null}
        onClose={() => {
          setGlobalConfirm(null);
          hiveGetStatus().then(setStatus).catch(() => {});
        }}
        ariaLabel="Confirm global autonomy"
      >
        <h3 style={{ margin: 0 }}>
          Raise global autonomy to {globalConfirm?.toFixed(2)}?
        </h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Levels at 0.7+ allow the hive to act without asking first on most
          decisions across every tentacle.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button
            variant="ghost"
            onClick={() => {
              setGlobalConfirm(null);
              hiveGetStatus().then(setStatus).catch(() => {});
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => globalConfirm !== null && commitGlobal(globalConfirm)}
            disabled={busy === 'global'}
          >
            {busy === 'global' ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={cellConfirm !== null}
        onClose={() => {
          if (cellConfirm) {
            // Revert optimistic change by re-reading autonomy for this cell.
            organGetAutonomy({
              organ: cellConfirm.platform,
              action: cellConfirm.action,
            })
              .then((v) => {
                setMatrix((prev) => ({
                  ...prev,
                  [cellConfirm.platform]: {
                    ...prev[cellConfirm.platform],
                    [cellConfirm.action]: v,
                  },
                }));
              })
              .catch(() => {});
          }
          setCellConfirm(null);
        }}
        ariaLabel="Confirm cell autonomy"
      >
        <h3 style={{ margin: 0 }}>
          Raise {cellConfirm?.platform} / {cellConfirm?.action} to level {cellConfirm?.level}?
        </h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Levels 4-5 let this tentacle perform this action without asking first.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button
            variant="ghost"
            onClick={() => {
              if (cellConfirm) {
                organGetAutonomy({
                  organ: cellConfirm.platform,
                  action: cellConfirm.action,
                })
                  .then((v) => {
                    setMatrix((prev) => ({
                      ...prev,
                      [cellConfirm.platform]: {
                        ...prev[cellConfirm.platform],
                        [cellConfirm.action]: v,
                      },
                    }));
                  })
                  .catch(() => {});
              }
              setCellConfirm(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              cellConfirm &&
              commitCell(cellConfirm.platform, cellConfirm.action, cellConfirm.level)
            }
            disabled={busy !== null && busy !== 'global'}
          >
            Confirm
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
