// src/features/body/BodySystemDetail.tsx — BODY-02.
//
// Plan 08-03 Task 1: real implementation.
//
// Reads prefs['body.activeSystem'] (default 'nervous'), renders the module
// list via bodyGetSystem(system), and exposes 3 tabs:
//   Modules / Vitals / Events
//
// Vitals tab branches by system (D-202):
//   cardiovascular → cardio_get_blood_pressure + blade_vital_signs + supervisorGetHealth
//   immune OR urinary → urinary_flush + immune_get_status (flush is Dialog-gated)
//   identity       → reproductive_get_dna + Dialog-gated reproductive_spawn
//   skeleton       → joints_list_providers + joints_list_stores
//   other          → honest empty state
//
// Events tab: cardio_get_event_registry for cardiovascular; empty state elsewhere.
//
// Cross-cluster imports (D-196 last bullet, D-194):
//   - supervisorGetHealth from @/lib/tauri/admin (Phase 7) — services health grid.
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 1
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-202
// @see .planning/REQUIREMENTS.md §BODY-02

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Input, Pill, EmptyState, ListSkeleton } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import {
  bladeVitalSigns,
  bodyGetSystem,
  cardioGetBloodPressure,
  cardioGetEventRegistry,
  immuneGetStatus,
  jointsListProviders,
  jointsListStores,
  reproductiveGetDna,
  reproductiveSpawn,
  urinaryFlush,
} from '@/lib/tauri/body';
import type {
  BloodPressure,
  EventInfo,
  ImmuneStatus,
  InheritedDna,
  ModuleMapping,
  VitalSigns,
} from '@/lib/tauri/body';
import { supervisorGetHealth } from '@/lib/tauri/admin';
import type { SupervisorService } from '@/lib/tauri/admin';
import './body.css';

type DetailTab = 'modules' | 'vitals' | 'events';

const DEFAULT_SYSTEM = 'nervous';

function formatNumber(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

export function BodySystemDetail() {
  const { prefs, setPref } = usePrefs();
  const router = useRouterCtx();
  const toast = useToast();

  const activeRaw = prefs['body.activeSystem'];
  const activeSystem =
    typeof activeRaw === 'string' && activeRaw.length > 0 ? activeRaw : DEFAULT_SYSTEM;

  const [tab, setTab] = useState<DetailTab>('modules');
  const [modules, setModules] = useState<ModuleMapping[] | null>(null);
  const [loadingModules, setLoadingModules] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingModules(true);
    setError(null);
    bodyGetSystem({ system: activeSystem })
      .then((rows) => {
        if (!cancelled) setModules(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(typeof e === 'string' ? e : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingModules(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSystem]);

  const handleSwitchSystem = (next: string) => {
    setPref('body.activeSystem', next);
  };

  const description =
    modules && modules.length > 0 ? modules[0].description : '';

  return (
    <GlassPanel tier={1} className="body-system-detail" data-testid="body-system-detail-root">
      <header className="body-system-detail-header">
        <div>
          <h1 className="body-system-detail-title">{activeSystem}</h1>
          <p className="body-system-detail-sub">
            {modules ? `${modules.length} modules` : 'Loading system…'}
            {description ? ` · ${description}` : ''}
          </p>
        </div>
        <div className="body-system-detail-actions">
          <Button
            variant="ghost"
            onClick={() => router.openRoute('body-map')}
            data-testid="body-system-back"
          >
            ← Back to Body Map
          </Button>
        </div>
      </header>

      <div className="body-system-detail-tabs" role="tablist" aria-label="System detail sections">
        {(
          [
            ['modules', 'Modules'],
            ['vitals', 'Vitals'],
            ['events', 'Events'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="body-system-detail-tab"
            data-active={tab === id}
            data-testid={`body-system-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <GlassPanel tier={2} className="body-system-detail-error">
          <strong>Failed to load system.</strong>
          <p>{error}</p>
        </GlassPanel>
      )}

      <div className="body-system-detail-body" role="tabpanel">
        {tab === 'modules' && (
          <ModulesTab
            loading={loadingModules}
            modules={modules}
            onPickRelated={handleSwitchSystem}
          />
        )}

        {tab === 'vitals' && (
          <VitalsTab
            system={activeSystem}
            toast={toast}
          />
        )}

        {tab === 'events' && <EventsTab system={activeSystem} />}
      </div>
    </GlassPanel>
  );
}

// ─── Modules tab ────────────────────────────────────────────────────────────

function ModulesTab({
  loading,
  modules,
  onPickRelated,
}: {
  loading: boolean;
  modules: ModuleMapping[] | null;
  onPickRelated: (system: string) => void;
}) {
  if (loading) {
    return <ListSkeleton rows={5} />;
  }
  if (!modules || modules.length === 0) {
    return <EmptyState label="No modules registered" description="This body system has no modules registered." />;
  }
  return (
    <ul className="body-module-list list-entrance" data-testid="body-module-list">
      {modules.map((m) => (
        <li
          key={m.module}
          className="body-module-row"
          data-testid={`module-row-${m.module}`}
        >
          <div className="body-module-row-head">
            <span className="body-module-name">{m.module}</span>
            <Pill tone="default">{m.organ}</Pill>
            <button
              type="button"
              className="body-module-related"
              onClick={() => onPickRelated(m.body_system)}
              aria-label={`Focus ${m.body_system}`}
            >
              {m.body_system}
            </button>
          </div>
          <p className="body-module-desc">{m.description}</p>
        </li>
      ))}
    </ul>
  );
}

// ─── Vitals tab ─────────────────────────────────────────────────────────────

type ToastShow = ReturnType<typeof useToast>;

function VitalsTab({
  system,
  toast,
}: {
  system: string;
  toast: ToastShow;
}) {
  if (system === 'cardiovascular') return <CardioVitals toast={toast} />;
  if (system === 'immune' || system === 'urinary') return <UrinaryImmuneVitals toast={toast} />;
  if (system === 'identity') return <IdentityVitals toast={toast} />;
  if (system === 'skeleton') return <SkeletonVitals />;
  return (
    <div data-testid="body-system-vitals-empty">
      <EmptyState label="No vitals for this system" />
    </div>
  );
}

function CardioVitals({ toast }: { toast: ToastShow }) {
  const [bp, setBp] = useState<BloodPressure | null>(null);
  const [vitals, setVitals] = useState<VitalSigns | null>(null);
  const [services, setServices] = useState<SupervisorService[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [pressure, vital, svc] = await Promise.all([
        cardioGetBloodPressure(),
        bladeVitalSigns(),
        supervisorGetHealth().catch(() => null), // cross-cluster read; soft-fail
      ]);
      setBp(pressure);
      setVitals(vital);
      setServices(svc);
    } catch (e) {
      const msg = typeof e === 'string' ? e : String(e);
      setError(msg);
      toast.show({ type: 'error', title: 'Vitals unavailable', message: msg });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (busy && !bp && !vitals) {
    return (
      <div className="body-system-detail-loading">
        <GlassSpinner />
        <span>Reading vital signs…</span>
      </div>
    );
  }

  return (
    <div className="body-vitals-grid" data-testid="cardio-vitals">
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Blood pressure</h3>
        {bp ? (
          <ul className="body-vitals-stats">
            <li>
              <span>Events / min</span>
              <strong>{formatNumber(bp.events_per_minute)}</strong>
            </li>
            <li>
              <span>API calls / min</span>
              <strong>{formatNumber(bp.api_calls_per_minute)}</strong>
            </li>
            <li>
              <span>Errors / min</span>
              <strong>{formatNumber(bp.errors_per_minute)}</strong>
            </li>
            <li>
              <span>Total events</span>
              <strong>{formatNumber(bp.total_events)}</strong>
            </li>
          </ul>
        ) : (
          <p className="body-system-detail-empty">No pressure reading.</p>
        )}
      </GlassPanel>
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Vital signs</h3>
        {vitals ? (
          <ul className="body-vitals-stats">
            <li>
              <span>Services alive</span>
              <strong>{formatNumber(vitals.services_alive)}</strong>
            </li>
            <li>
              <span>Services dead</span>
              <strong>{vitals.services_dead.length}</strong>
            </li>
            <li>
              <span>Brain working memory</span>
              <strong>{vitals.brain_working_memory_active ? 'active' : 'idle'}</strong>
            </li>
          </ul>
        ) : (
          <p className="body-system-detail-empty">No vitals reading.</p>
        )}
      </GlassPanel>
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Supervisor (cross-cluster)</h3>
        {services === null ? (
          <p className="body-system-detail-empty">Supervisor read unavailable.</p>
        ) : services.length === 0 ? (
          <p className="body-system-detail-empty">No managed services.</p>
        ) : (
          <ul className="body-vitals-services">
            {services.slice(0, 8).map((svc) => (
              <li key={svc.name} className="body-vitals-service-row">
                <span>{svc.name}</span>
                <Pill tone={svc.status === 'running' ? 'free' : 'new'}>
                  {svc.status}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
      {error && <p className="body-system-detail-empty">{error}</p>}
      <Button variant="ghost" onClick={reload} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  );
}

function UrinaryImmuneVitals({ toast }: { toast: ToastShow }) {
  const [immune, setImmune] = useState<ImmuneStatus | null>(null);
  const [lastFlush, setLastFlush] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    immuneGetStatus()
      .then((s) => {
        if (!cancelled) setImmune(s);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.show({ type: 'error', title: 'Immune status failed', message: String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const runFlush = async () => {
    setBusy(true);
    try {
      const bytes = await urinaryFlush();
      setLastFlush(bytes);
      toast.show({
        type: 'success',
        title: 'Flush complete',
        message: `Reclaimed ${bytes.toLocaleString()} bytes`,
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Flush failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="body-vitals-grid" data-testid="urinary-immune-vitals">
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Immune</h3>
        {immune ? (
          <ul className="body-vitals-stats">
            <li>
              <span>Threats (last hour)</span>
              <strong>{formatNumber(immune.threats_last_hour)}</strong>
            </li>
            <li>
              <span>Blocked actions</span>
              <strong>{formatNumber(immune.blocked_actions)}</strong>
            </li>
            <li>
              <span>Status</span>
              <strong>{immune.status}</strong>
            </li>
          </ul>
        ) : (
          <p className="body-system-detail-empty">Loading…</p>
        )}
      </GlassPanel>
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Urinary flush</h3>
        <p>Flushes expired cache + stale state. Destructive — Dialog-gated.</p>
        <Button
          variant="secondary"
          onClick={() => setConfirming(true)}
          disabled={busy}
          data-testid="urinary-flush-button"
        >
          {busy ? 'Flushing…' : 'Run flush'}
        </Button>
        {lastFlush !== null && (
          <p className="body-system-detail-sub">
            Last flush reclaimed <strong>{lastFlush.toLocaleString()}</strong> bytes.
          </p>
        )}
      </GlassPanel>
      <Dialog open={confirming} onClose={() => setConfirming(false)} ariaLabel="Confirm urinary flush">
        <h3>Run urinary flush?</h3>
        <p>This will drop expired cache entries and stale state. Safe but irreversible.</p>
        <div className="body-dialog-actions">
          <Button variant="primary" onClick={runFlush} disabled={busy}>
            {busy ? 'Flushing…' : 'Confirm'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function IdentityVitals({ toast }: { toast: ToastShow }) {
  const [dna, setDna] = useState<InheritedDna | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [agentType, setAgentType] = useState('claude-code');
  const [task, setTask] = useState('Summarise open items');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reproductiveGetDna()
      .then((d) => {
        if (!cancelled) setDna(d);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.show({ type: 'error', title: 'DNA package read failed', message: String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const runSpawn = async () => {
    if (!task.trim()) {
      toast.show({ type: 'warn', title: 'Task required' });
      return;
    }
    setBusy(true);
    try {
      const r = await reproductiveSpawn({ agentType: agentType.trim(), task: task.trim() });
      setResult(r);
      toast.show({ type: 'success', title: 'Child agent spawned' });
      setSpawnOpen(false);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Spawn failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="body-vitals-grid" data-testid="identity-vitals">
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Inherited DNA package</h3>
        {dna ? (
          <ul className="body-vitals-stats">
            <li>
              <span>Identity</span>
              <strong>{(dna.identity || '').slice(0, 80) || '—'}</strong>
            </li>
            <li>
              <span>Voice</span>
              <strong>{(dna.voice || '').slice(0, 80) || '—'}</strong>
            </li>
            <li>
              <span>Trust level</span>
              <strong>{formatNumber(dna.trust_level)}</strong>
            </li>
            <li>
              <span>Active project</span>
              <strong>{dna.active_project || '—'}</strong>
            </li>
            <li>
              <span>Preferences</span>
              <strong>{dna.preferences.length} entries</strong>
            </li>
          </ul>
        ) : (
          <p className="body-system-detail-empty">Loading DNA package…</p>
        )}
      </GlassPanel>
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Spawn child agent</h3>
        <p>Forks a new agent carrying the inherited DNA. Dialog-gated.</p>
        <Button
          variant="secondary"
          onClick={() => setSpawnOpen(true)}
          data-testid="reproductive-spawn-button"
        >
          Open spawn dialog
        </Button>
        {result && (
          <p className="body-system-detail-sub">Last spawn: {result}</p>
        )}
      </GlassPanel>
      <Dialog open={spawnOpen} onClose={() => setSpawnOpen(false)} ariaLabel="Spawn child agent">
        <h3>Spawn child agent</h3>
        <label className="body-dialog-label">
          Agent type
          <Input
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
            placeholder="claude-code | goose | aider"
            disabled={busy}
          />
        </label>
        <label className="body-dialog-label">
          Initial task
          <Input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what the child should do"
            disabled={busy}
          />
        </label>
        <div className="body-dialog-actions">
          <Button variant="primary" onClick={runSpawn} disabled={busy}>
            {busy ? 'Spawning…' : 'Confirm spawn'}
          </Button>
          <Button variant="ghost" onClick={() => setSpawnOpen(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function SkeletonVitals() {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [stores, setStores] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([jointsListProviders(), jointsListStores()])
      .then(([p, s]) => {
        if (cancelled) return;
        setProviders(p);
        setStores(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(typeof e === 'string' ? e : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="body-vitals-grid" data-testid="skeleton-vitals">
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Context providers</h3>
        {providers === null ? (
          <p className="body-system-detail-empty">Loading…</p>
        ) : providers.length === 0 ? (
          <p className="body-system-detail-empty">No providers registered.</p>
        ) : (
          <div className="body-vitals-chips">
            {providers.map((p) => (
              <Pill key={p} tone="default">
                {p}
              </Pill>
            ))}
          </div>
        )}
      </GlassPanel>
      <GlassPanel tier={2} className="body-vitals-card">
        <h3>Memory stores</h3>
        {stores === null ? (
          <p className="body-system-detail-empty">Loading…</p>
        ) : stores.length === 0 ? (
          <p className="body-system-detail-empty">No stores registered.</p>
        ) : (
          <div className="body-vitals-chips">
            {stores.map((s) => (
              <Pill key={s} tone="default">
                {s}
              </Pill>
            ))}
          </div>
        )}
      </GlassPanel>
      {error && <p className="body-system-detail-empty">{error}</p>}
    </div>
  );
}

// ─── Events tab ─────────────────────────────────────────────────────────────

function EventsTab({ system }: { system: string }) {
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (system !== 'cardiovascular') {
      setEvents(null);
      return;
    }
    let cancelled = false;
    cardioGetEventRegistry()
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(typeof e === 'string' ? e : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [system]);

  if (system !== 'cardiovascular') {
    return (
      <p className="body-system-detail-empty" data-testid="body-system-events-empty">
        No event registry for {system}. Only the cardiovascular system catalogues events today.
      </p>
    );
  }

  if (error) {
    return <p className="body-system-detail-empty">{error}</p>;
  }

  if (events === null) {
    return (
      <div className="body-system-detail-loading">
        <GlassSpinner />
        <span>Loading event registry…</span>
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="body-system-detail-empty">No events registered.</p>;
  }

  return (
    <table className="body-events-table" data-testid="body-events-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Direction</th>
          <th>Category</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr key={ev.name}>
            <td>
              <code>{ev.name}</code>
            </td>
            <td>{ev.direction}</td>
            <td>{ev.category}</td>
            <td>{ev.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
