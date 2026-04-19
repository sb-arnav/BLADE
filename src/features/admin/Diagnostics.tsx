// src/features/admin/Diagnostics.tsx
//
// Admin cluster — Diagnostics route (ADMIN-07, D-184 + ROADMAP SC-4 falsifier).
// Hero = supervisor_get_health() grid; 6 tabs persisted via
// prefs['admin.activeTab'] with prefix "diag:":
//   Health / Traces / Authority / Deep scan / Sysadmin / Config.
//
// SC-4: "Diagnostics view shows module health for all running background
// tasks" — the <supervisor-health-grid/> is the direct falsifier.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-184
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4, §5
// @see src/lib/tauri/admin.ts (supervisor*, trace*, authority*, deep_scan*, config*)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Input, EmptyState } from '@/design-system/primitives';
import { ListSkeleton } from '@/design-system/primitives/ListSkeleton';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  authorityDelegate,
  authorityGetAgents,
  authorityGetDelegations,
  authorityRouteAndRun,
  authorityRunChain,
  debugConfig,
  deepScanResults,
  deepScanStart,
  deepScanSummary,
  getRecentTraces,
  resetOnboarding,
  setConfig,
  supervisorGetHealth,
  updateInitPrefs,
} from '@/lib/tauri/admin';
import type {
  AuthorityAgent,
  AuthorityDelegation,
  DeepScanResult,
  SupervisorService,
  TraceEntry,
} from './types';
import { DiagnosticsSysadminTab } from './DiagnosticsSysadminTab';
import './admin.css';
import './admin-rich-b.css';

type DiagTab = 'health' | 'traces' | 'authority' | 'deep' | 'sysadmin' | 'config';
const TAB_PREF_KEY = 'admin.activeTab';
const TAB_PREF_PREFIX = 'diag:';
const DEFAULT_TAB: DiagTab = 'health';

function readInitialTab(raw: string | number | boolean | undefined): DiagTab {
  if (typeof raw === 'string' && raw.startsWith(TAB_PREF_PREFIX)) {
    const t = raw.slice(TAB_PREF_PREFIX.length) as DiagTab;
    if (
      t === 'health' ||
      t === 'traces' ||
      t === 'authority' ||
      t === 'deep' ||
      t === 'sysadmin' ||
      t === 'config'
    ) {
      return t;
    }
  }
  return DEFAULT_TAB;
}

function statusAttr(status: string): 'complete' | 'failed' | 'idle' {
  const s = (status ?? '').toLowerCase();
  if (s === 'running' || s === 'healthy' || s === 'ok') return 'complete';
  if (s === 'error' || s === 'dead' || s === 'crashed' || s === 'failed') return 'failed';
  return 'idle';
}

export function Diagnostics() {
  const { prefs, setPref } = usePrefs();
  const [tab, setTab] = useState<DiagTab>(() => readInitialTab(prefs[TAB_PREF_KEY]));

  const [health, setHealth] = useState<SupervisorService[] | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const list = await supervisorGetHealth();
      setHealth(list);
      setHealthError(null);
    } catch (e) {
      setHealthError(typeof e === 'string' ? e : String(e));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const handleTabChange = (next: DiagTab) => {
    setTab(next);
    setPref(TAB_PREF_KEY, `${TAB_PREF_PREFIX}${next}`);
  };

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="diagnostics-root">
      <div className="diagnostics-layout">
        <section className="diagnostics-hero">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h3>Supervisor health (SC-4)</h3>
            <Button variant="ghost" onClick={refreshHealth} disabled={healthLoading}>
              {healthLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
          {healthError && <p className="admin-empty">Error: {healthError}</p>}
          {healthLoading && !health && <ListSkeleton rows={4} rowHeight={72} />}
          <div className="admin-health-grid list-entrance" data-testid="supervisor-health-grid">
            {(health ?? []).map((svc) => (
              <div
                key={svc.name}
                className="admin-card"
                data-status={statusAttr(svc.status)}
                data-testid="health-card"
              >
                <div className="admin-card-title">{svc.name}</div>
                <div className="admin-card-meta">{svc.status}</div>
                {svc.uptime_secs != null && (
                  <div className="admin-card-secondary">
                    up {Math.round((svc.uptime_secs ?? 0) / 60)}m • crashes {svc.crash_count ?? 0}
                  </div>
                )}
              </div>
            ))}
            {health && health.length === 0 && (
              <div className="admin-card" data-status="idle">
                <div className="admin-card-title">No services reported</div>
                <div className="admin-card-meta">Supervisor returned 0 entries.</div>
              </div>
            )}
          </div>
        </section>

        <div className="admin-tabs" role="tablist" aria-label="Diagnostics sections">
          {(
            [
              ['health', 'Health'],
              ['traces', 'Traces'],
              ['authority', 'Authority'],
              ['deep', 'Deep scan'],
              ['sysadmin', 'Sysadmin'],
              ['config', 'Config'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="admin-tab-pill"
              data-active={tab === id}
              data-testid="diagnostics-tab"
              data-tab={id}
              onClick={() => handleTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'health' && (
          <HealthTab health={health} loading={healthLoading} onRefresh={refreshHealth} />
        )}
        {tab === 'traces' && <TracesTab />}
        {tab === 'authority' && <AuthorityTab />}
        {tab === 'deep' && <DeepScanTab />}
        {tab === 'sysadmin' && <DiagnosticsSysadminTab />}
        {tab === 'config' && <ConfigTab />}
      </div>
    </GlassPanel>
  );
}

// ─── Health tab (repeats hero grid with service-level detail) ───────────────

function HealthTab(props: {
  health: SupervisorService[] | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Service detail</h4>
        <Button variant="ghost" onClick={() => void props.onRefresh()} disabled={props.loading}>
          {props.loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <div className="admin-row-list">
        {(props.health ?? []).map((svc) => (
          <div key={svc.name} className="diagnostics-trace-row">
            <span>{svc.name}</span>
            <span>
              {svc.status} • crashes {svc.crash_count} • up{' '}
              {Math.round((svc.uptime_secs ?? 0) / 60)}m
            </span>
          </div>
        ))}
        {props.health && props.health.length === 0 && (
          <p className="admin-empty">No services.</p>
        )}
      </div>
    </section>
  );
}

// ─── Traces tab ─────────────────────────────────────────────────────────────

function TracesTab() {
  const [traces, setTraces] = useState<TraceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getRecentTraces();
      setTraces(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Recent traces</h4>
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      <div className="diagnostics-traces-list" data-testid="diagnostics-traces-list">
        {(traces ?? []).map((t) => (
          <div key={t.trace_id} className="diagnostics-trace-row">
            <span>
              {t.method} • {t.provider}/{t.model}
            </span>
            <span>
              {t.success ? 'ok' : 'err'} • {t.duration_ms}ms • {t.timestamp}
            </span>
          </div>
        ))}
        {traces && traces.length === 0 && <p className="admin-empty">No traces yet.</p>}
      </div>
    </section>
  );
}

// ─── Authority tab ──────────────────────────────────────────────────────────

function AuthorityTab() {
  const [agents, setAgents] = useState<AuthorityAgent[] | null>(null);
  const [delegations, setDelegations] = useState<AuthorityDelegation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [delegateOpen, setDelegateOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([authorityGetAgents(), authorityGetDelegations(50)]);
      setAgents(a);
      setDelegations(d);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Authority</h4>
        <div className="admin-inline-row">
          <Button variant="secondary" size="sm" onClick={() => setDelegateOpen(true)}>
            Delegate
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRouteOpen(true)}>
            Route and run
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setChainOpen(true)}>
            Run chain
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
        <div>
          <strong style={{ color: 'var(--t-1)', fontSize: 13 }}>Agents</strong>
          <div className="admin-row-list" style={{ marginTop: 'var(--s-1)' }}>
            {(agents ?? []).map((a) => (
              <div key={a.agent_type} className="temporal-exmem-row">
                <div className="temporal-exmem-row-cmd">{a.agent_type}</div>
                <div className="temporal-exmem-row-meta">{a.description}</div>
              </div>
            ))}
            {agents && agents.length === 0 && <p className="admin-empty">No agents.</p>}
          </div>
        </div>
        <div>
          <strong style={{ color: 'var(--t-1)', fontSize: 13 }}>Delegations</strong>
          <div className="admin-row-list" style={{ marginTop: 'var(--s-1)' }}>
            {(delegations ?? []).map((d) => (
              <div key={d.id} className="temporal-exmem-row">
                <div className="temporal-exmem-row-cmd">{d.task}</div>
                <div className="temporal-exmem-row-meta">
                  → {d.delegated_to} • {d.status}
                </div>
              </div>
            ))}
            {delegations && delegations.length === 0 && (
              <p className="admin-empty">No delegations.</p>
            )}
          </div>
        </div>
      </div>

      <DelegateDialog
        open={delegateOpen}
        onClose={() => setDelegateOpen(false)}
        onDone={refresh}
        agents={agents ?? []}
      />
      <RouteAndRunDialog
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        onDone={refresh}
      />
      <RunChainDialog open={chainOpen} onClose={() => setChainOpen(false)} onDone={refresh} />
    </section>
  );
}

function DelegateDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  agents: AuthorityAgent[];
}) {
  const [task, setTask] = useState('');
  const [agent, setAgent] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const out = await authorityDelegate({
        task,
        agentType: agent,
        context: context || undefined,
      });
      toast.show({ type: 'success', title: 'Delegated', message: out });
      await props.onDone();
      props.onClose();
      setTask('');
      setAgent('');
      setContext('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Delegate failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [task, agent, context, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Delegate">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Delegate task</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Task
          <Input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            aria-label="Delegate task"
          />
        </label>
        <label className="admin-dialog-label">
          Agent
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="mcp-tool-trust-select"
            aria-label="Agent type"
          >
            <option value="">— pick agent —</option>
            {props.agents.map((a) => (
              <option key={a.agent_type} value={a.agent_type}>
                {a.agent_type}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-dialog-label">
          Context (optional)
          <textarea
            className="admin-dialog-textarea"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            aria-label="Context"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || !task.trim() || !agent.trim()}
        >
          {busy ? 'Delegating…' : 'Delegate'}
        </Button>
      </div>
    </Dialog>
  );
}

function RouteAndRunDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const out = await authorityRouteAndRun(task);
      toast.show({ type: 'success', title: 'Routed', message: out });
      await props.onDone();
      props.onClose();
      setTask('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Route failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [task, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Route and run">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Route and run</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Task
          <Input value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy || !task.trim()}>
          {busy ? 'Routing…' : 'Route and run'}
        </Button>
      </div>
    </Dialog>
  );
}

function RunChainDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [task, setTask] = useState('');
  const [agentsCsv, setAgentsCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    const agents = agentsCsv
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!task.trim() || agents.length === 0) {
      toast.show({ type: 'warn', title: 'Task and at least one agent required' });
      return;
    }
    setBusy(true);
    try {
      const outputs = await authorityRunChain({ task, agents });
      toast.show({
        type: 'success',
        title: 'Chain complete',
        message: `${outputs.length} stages`,
      });
      await props.onDone();
      props.onClose();
      setTask('');
      setAgentsCsv('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Chain failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [task, agentsCsv, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Run chain">
      <div className="danger-banner">
        Chains can run multiple agents in sequence and may be long-running. Confirm below.
      </div>
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Run chain</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Task
          <Input value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />
        </label>
        <label className="admin-dialog-label">
          Agents (comma separated)
          <Input
            value={agentsCsv}
            onChange={(e) => setAgentsCsv(e.target.value)}
            aria-label="Agents"
            placeholder="researcher, writer, reviewer"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy}>
          {busy ? 'Running…' : 'Run chain'}
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Deep scan tab ──────────────────────────────────────────────────────────

function DeepScanTab() {
  const [result, setResult] = useState<DeepScanResult | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const r = await deepScanResults();
      setResult(r);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runNow = useCallback(async () => {
    setBusy(true);
    try {
      const out = await deepScanStart();
      setResult(out);
      toast.show({ type: 'success', title: 'Deep scan complete' });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Deep scan failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await deepScanSummary();
      setSummary(s);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Summary failed',
        message: typeof e === 'string' ? e : String(e),
      });
    }
  }, [toast]);

  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Deep scan</h4>
        <div className="admin-inline-row">
          <Button variant="secondary" size="sm" onClick={runNow} disabled={busy}>
            {busy ? (
              <>
                <GlassSpinner /> Scanning…
              </>
            ) : (
              'Run now'
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={loadSummary}>
            Summary
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      {summary && <div className="temporal-recall-card">{summary}</div>}
      {result ? (
        <pre className="diagnostics-config-pre">{JSON.stringify(result, null, 2)}</pre>
      ) : (
        <EmptyState
          label="No diagnostics"
          description="Run deep scan to populate."
          actionLabel="Run deep scan"
          onAction={() => void runNow()}
        />
      )}
    </section>
  );
}

// ─── Config tab ─────────────────────────────────────────────────────────────

function ConfigTab() {
  const [config, setCfg] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setConfigOpen, setSetConfigOpen] = useState(false);
  const [initPrefsOpen, setInitPrefsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = await debugConfig();
      setCfg(c);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configText = useMemo(() => (config ? JSON.stringify(config, null, 2) : ''), [config]);

  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Config</h4>
        <div className="admin-inline-row">
          <Button variant="secondary" size="sm" onClick={() => setSetConfigOpen(true)}>
            Set config
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setInitPrefsOpen(true)}>
            Update init prefs
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setResetOpen(true)}
            data-testid="diagnostics-reset-onboarding-button"
          >
            Reset onboarding
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      <pre className="diagnostics-config-pre" data-testid="diagnostics-config-pre">
        {configText || '(empty)'}
      </pre>
      <SetConfigDialog
        open={setConfigOpen}
        onClose={() => setSetConfigOpen(false)}
        onDone={refresh}
      />
      <InitPrefsDialog
        open={initPrefsOpen}
        onClose={() => setInitPrefsOpen(false)}
        onDone={refresh}
      />
      <ResetOnboardingDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onDone={refresh}
      />
    </section>
  );
}

function SetConfigDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await setConfig({ provider, apiKey, model });
      toast.show({ type: 'success', title: 'Config saved' });
      await props.onDone();
      props.onClose();
      setApiKey('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Save failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [provider, apiKey, model, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Set config">
      <div className="danger-banner">
        Overwriting provider config can break in-flight chat. Confirm below.
      </div>
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Set config</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Provider
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
          />
        </label>
        <label className="admin-dialog-label">
          API key
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            aria-label="API key"
          />
        </label>
        <label className="admin-dialog-label">
          Model
          <Input value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || !provider.trim() || !apiKey.trim() || !model.trim()}
        >
          {busy ? 'Saving…' : 'Save config'}
        </Button>
      </div>
    </Dialog>
  );
}

function InitPrefsDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [userName, setUserName] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [responseStyle, setResponseStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await updateInitPrefs({
        userName: userName || undefined,
        workMode: workMode || undefined,
        responseStyle: responseStyle || undefined,
      });
      toast.show({ type: 'success', title: 'Init prefs updated' });
      await props.onDone();
      props.onClose();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Update failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [userName, workMode, responseStyle, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Update init prefs">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Update init prefs</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          User name
          <Input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            aria-label="User name"
          />
        </label>
        <label className="admin-dialog-label">
          Work mode
          <Input
            value={workMode}
            onChange={(e) => setWorkMode(e.target.value)}
            aria-label="Work mode"
          />
        </label>
        <label className="admin-dialog-label">
          Response style
          <Input
            value={responseStyle}
            onChange={(e) => setResponseStyle(e.target.value)}
            aria-label="Response style"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}

function ResetOnboardingDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await resetOnboarding();
      toast.show({
        type: 'success',
        title: 'Onboarding reset',
        message: 'Next launch will re-run onboarding.',
      });
      await props.onDone();
      props.onClose();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Reset failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Reset onboarding">
      <div className="danger-banner">
        Reset onboarding wipes init prefs and forces a fresh first-run flow. This cannot be
        undone.
      </div>
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Reset onboarding</h3>
      <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
        Continue?
      </p>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy}>
          {busy ? 'Resetting…' : 'Reset onboarding'}
        </Button>
      </div>
    </Dialog>
  );
}
