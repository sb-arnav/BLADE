// src/features/admin/CapabilityReports.tsx — Plan 07-05 Task 1 (ADMIN-02).
//
// Real body per D-182 — sections rendered in order:
//   1. Level hero card — evolutionGetLevel().
//   2. Suggestions list — evolutionGetSuggestions() + Install/Dismiss per row
//      (Install requires token_key + token_value per Rust signature).
//   3. Catalog — selfUpgradeCatalog() + Install (Dialog-confirm).
//   4. Audit — selfUpgradeAudit() read-only list.
//   5. Gaps — evolutionLogCapabilityGap(capability + user_request) form +
//      immuneResolveGap per entry (auto-resolve via immune system).
//   6. Self-critique — selfCritiqueHistory(limit) + Deep roast Dialog +
//      Weekly meta action.
//   7. Forge — forgeListTools() cards + New tool Dialog + Test + Delete
//      (Delete Dialog-confirmed per Pattern §4).
//
// Rust shape corrections (per Plan 07-02 SUMMARY):
//   - evolutionInstallSuggestion takes `{ id, token_key, token_value }` — the
//     token is the payload required by the installer (API key etc.).
//   - evolutionLogCapabilityGap takes `{ capability, user_request }`.
//   - immuneResolveGap takes `{ capability, user_request }` (not a gapId).
//   - selfUpgradeInstall takes a flat `tool_key: string`, returns a struct
//     `{ tool, success, output }`.
//   - selfCritiqueDeepRoast takes `{ user_request, blade_response }` — pair.
//   - forgeNewTool takes a flat `capability: string` — the capability
//     description; the tool is synthesized server-side.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-182

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, Input, Pill, GlassSpinner, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  evolutionGetLevel,
  evolutionGetSuggestions,
  evolutionDismissSuggestion,
  evolutionInstallSuggestion,
  evolutionRunNow,
  evolutionLogCapabilityGap,
  immuneResolveGap,
  selfUpgradeCatalog,
  selfUpgradeInstall,
  selfUpgradeAudit,
  selfCritiqueHistory,
  selfCritiqueDeepRoast,
  selfCritiqueWeeklyMeta,
  forgeListTools,
  forgeNewTool,
  forgeDeleteTool,
  forgeTestTool,
} from '@/lib/tauri/admin';
import type {
  EvolutionLevel,
  EvolutionSuggestion,
  UpgradeCatalogEntry,
  CritiqueEntry,
  ForgeTool,
} from './types';
import './admin.css';
import './admin-rich-a.css';

interface LoggedGap {
  id: string;
  capability: string;
  userRequest: string;
  loggedAt: number;
}

function formatTs(ts: number): string {
  try {
    return new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function CapabilityReports() {
  const toast = useToast();

  const [level, setLevel] = useState<EvolutionLevel | null>(null);
  const [suggestions, setSuggestions] = useState<EvolutionSuggestion[]>([]);
  const [catalog, setCatalog] = useState<UpgradeCatalogEntry[]>([]);
  const [audit, setAudit] = useState<Array<[string, boolean]>>([]);
  const [critique, setCritique] = useState<CritiqueEntry[]>([]);
  const [tools, setTools] = useState<ForgeTool[]>([]);
  const [loading, setLoading] = useState(true);

  // Locally-tracked gap log (we have no "get gaps" read endpoint — we track
  // what the user added this session so "Resolve" has a target).
  const [gaps, setGaps] = useState<LoggedGap[]>([]);
  const [gapCapability, setGapCapability] = useState('');
  const [gapRequest, setGapRequest] = useState('');
  const [gapBusy, setGapBusy] = useState(false);

  // Evolution Install dialog
  const [installSuggestion, setInstallSuggestion] = useState<EvolutionSuggestion | null>(null);
  const [installTokenKey, setInstallTokenKey] = useState('');
  const [installTokenValue, setInstallTokenValue] = useState('');
  const [installBusy, setInstallBusy] = useState(false);

  // Catalog install confirm dialog
  const [catalogInstalling, setCatalogInstalling] = useState<UpgradeCatalogEntry | null>(null);
  const [catalogInstallBusy, setCatalogInstallBusy] = useState(false);

  // Self-critique deep-roast dialog
  const [roastOpen, setRoastOpen] = useState(false);
  const [roastRequest, setRoastRequest] = useState('');
  const [roastResponse, setRoastResponse] = useState('');
  const [roastBusy, setRoastBusy] = useState(false);

  // Forge new-tool dialog
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeCapability, setForgeCapability] = useState('');
  const [forgeBusy, setForgeBusy] = useState(false);

  // Forge delete confirm
  const [deleteTool, setDeleteTool] = useState<ForgeTool | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      evolutionGetLevel(),
      evolutionGetSuggestions(),
      selfUpgradeCatalog(),
      selfUpgradeAudit(),
      selfCritiqueHistory(20),
      forgeListTools(),
    ]);
    if (results[0].status === 'fulfilled') setLevel(results[0].value);
    if (results[1].status === 'fulfilled') setSuggestions(results[1].value);
    if (results[2].status === 'fulfilled') setCatalog(results[2].value);
    if (results[3].status === 'fulfilled') setAudit(results[3].value);
    if (results[4].status === 'fulfilled') setCritique(results[4].value);
    if (results[5].status === 'fulfilled') setTools(results[5].value);

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some capability data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRunEvolution = useCallback(async () => {
    try {
      await evolutionRunNow();
      toast.show({ type: 'success', title: 'Evolution loop kicked off' });
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Evolution run failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [toast, loadAll]);

  const handleDismiss = useCallback(
    async (id: string) => {
      try {
        await evolutionDismissSuggestion(id);
        toast.show({ type: 'info', title: 'Suggestion dismissed' });
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Dismiss failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const handleConfirmInstall = useCallback(async () => {
    if (!installSuggestion || installBusy) return;
    setInstallBusy(true);
    try {
      const result = await evolutionInstallSuggestion({
        id: installSuggestion.id,
        tokenKey: installTokenKey.trim(),
        tokenValue: installTokenValue.trim(),
      });
      toast.show({
        type: 'success',
        title: 'Suggestion installed',
        message: result,
      });
      setInstallSuggestion(null);
      setInstallTokenKey('');
      setInstallTokenValue('');
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Install failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInstallBusy(false);
    }
  }, [installSuggestion, installBusy, installTokenKey, installTokenValue, toast, loadAll]);

  const handleConfirmCatalogInstall = useCallback(async () => {
    if (!catalogInstalling || catalogInstallBusy) return;
    setCatalogInstallBusy(true);
    try {
      // Catalog entries keyed by `description` per Rust CapabilityGap struct;
      // we pass the description as the tool_key.
      const result = await selfUpgradeInstall(catalogInstalling.description);
      toast.show({
        type: result.success ? 'success' : 'warn',
        title: result.success ? 'Installed' : 'Install reported issues',
        message: result.output || result.tool,
      });
      setCatalogInstalling(null);
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Install failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCatalogInstallBusy(false);
    }
  }, [catalogInstalling, catalogInstallBusy, toast, loadAll]);

  const handleLogGap = useCallback(async () => {
    if (gapBusy) return;
    const capability = gapCapability.trim();
    const userRequest = gapRequest.trim();
    if (!capability || !userRequest) return;
    setGapBusy(true);
    try {
      const id = await evolutionLogCapabilityGap({ capability, userRequest });
      toast.show({ type: 'success', title: 'Capability gap logged' });
      setGaps((prev) => [
        ...prev,
        { id: id || `${capability}-${Date.now()}`, capability, userRequest, loggedAt: Date.now() },
      ]);
      setGapCapability('');
      setGapRequest('');
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Log gap failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGapBusy(false);
    }
  }, [gapBusy, gapCapability, gapRequest, toast]);

  const handleResolveGap = useCallback(
    async (g: LoggedGap) => {
      try {
        const result = await immuneResolveGap({
          capability: g.capability,
          userRequest: g.userRequest,
        });
        toast.show({
          type: 'success',
          title: 'Immune system engaged',
          message: result || g.capability,
        });
        setGaps((prev) => prev.filter((x) => x.id !== g.id));
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Resolve failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const handleDeepRoast = useCallback(async () => {
    if (roastBusy) return;
    const req = roastRequest.trim();
    const resp = roastResponse.trim();
    if (!req || !resp) return;
    setRoastBusy(true);
    try {
      await selfCritiqueDeepRoast({ userRequest: req, bladeResponse: resp });
      toast.show({ type: 'success', title: 'Deep roast logged' });
      setRoastOpen(false);
      setRoastRequest('');
      setRoastResponse('');
      const history = await selfCritiqueHistory(20);
      setCritique(history);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Deep roast failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRoastBusy(false);
    }
  }, [roastBusy, roastRequest, roastResponse, toast]);

  const handleWeeklyMeta = useCallback(async () => {
    try {
      const result = await selfCritiqueWeeklyMeta();
      toast.show({
        type: 'info',
        title: 'Weekly meta-critique',
        message: result.length > 140 ? `${result.slice(0, 140)}…` : result,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Weekly meta failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [toast]);

  const handleNewTool = useCallback(async () => {
    if (forgeBusy) return;
    const cap = forgeCapability.trim();
    if (!cap) return;
    setForgeBusy(true);
    try {
      await forgeNewTool(cap);
      toast.show({ type: 'success', title: 'Tool forged', message: cap });
      setForgeOpen(false);
      setForgeCapability('');
      const next = await forgeListTools();
      setTools(next);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Forge failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setForgeBusy(false);
    }
  }, [forgeBusy, forgeCapability, toast]);

  const handleTestTool = useCallback(
    async (t: ForgeTool) => {
      try {
        const out = await forgeTestTool(t.id);
        toast.show({
          type: 'info',
          title: `Tested: ${t.name}`,
          message: out.length > 120 ? `${out.slice(0, 120)}…` : out,
        });
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Test failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTool || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await forgeDeleteTool(deleteTool.id);
      toast.show({ type: 'success', title: 'Tool deleted', message: deleteTool.name });
      setTools((prev) => prev.filter((x) => x.id !== deleteTool.id));
      setDeleteTool(null);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTool, deleteBusy, toast]);

  const critiqueSummary = useMemo(
    () => critique.slice(0, 8),
    [critique],
  );

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="capability-reports-root">
      <div className="admin-header">
        <div>
          <h2 className="admin-header-title">Capability Reports</h2>
          <div className="admin-header-meta">
            {loading ? 'Loading…' : `${suggestions.length} suggestions · ${tools.length} forged tools`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <Button variant="secondary" size="sm" onClick={() => void loadAll()} disabled={loading}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleRunEvolution()}>
            Run evolution now
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading capability reports" />
        </div>
      ) : (
        <>
          {/* 1. Level hero */}
          <div className="capability-level-hero" data-testid="evolution-level">
            <div className="admin-header-meta">Level</div>
            <div className="capability-level-value">
              {level ? `Lv ${level.level}` : '—'}
            </div>
            <div className="capability-level-score">
              {level ? `score ${level.score.toFixed(1)}` : '—'}
            </div>
            {level?.next_unlock ? (
              <div className="capability-level-breakdown">Next: {level.next_unlock}</div>
            ) : null}
            {level && level.breakdown.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 'var(--s-4)', color: 'var(--t-3)', fontSize: 12 }}>
                {level.breakdown.slice(0, 4).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* 2. Suggestions */}
          <div className="admin-section">
            <h3 className="admin-section-title">Suggestions</h3>
            {suggestions.length === 0 ? (
              <EmptyState
                label="BLADE is still learning your capability needs"
                description="Reports will appear once BLADE detects a gap — give me 24h."
              />
            ) : (
              <div className="capability-list">
                {suggestions.map((s) => (
                  <div key={s.id} className="capability-card" data-testid="evolution-suggestion">
                    <div className="capability-card-title">{s.name}</div>
                    <div className="capability-card-meta">
                      {s.package} · trigger: {s.trigger_app} · {s.status}
                    </div>
                    <div className="capability-card-description">{s.description}</div>
                    <div className="capability-card-actions">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setInstallSuggestion(s);
                          setInstallTokenKey(s.required_token_hint ?? '');
                          setInstallTokenValue('');
                        }}
                      >
                        Install
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDismiss(s.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Catalog */}
          <div className="admin-section">
            <h3 className="admin-section-title">Catalog</h3>
            {catalog.length === 0 ? (
              <div className="admin-empty">Catalog is empty.</div>
            ) : (
              <div className="capability-list">
                {catalog.map((entry, idx) => (
                  <div
                    key={`${entry.description}-${idx}`}
                    className="capability-card"
                    data-testid="capability-catalog-entry"
                  >
                    <div className="capability-card-title">{entry.description}</div>
                    <div className="capability-card-meta">{entry.category}</div>
                    <div className="capability-card-description">{entry.suggestion}</div>
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--t-3)',
                        background: 'rgba(255,255,255,0.03)',
                        padding: '2px 6px',
                        borderRadius: 'var(--r-sm)',
                      }}
                    >
                      {entry.install_cmd}
                    </code>
                    <div className="capability-card-actions">
                      <Button variant="primary" size="sm" onClick={() => setCatalogInstalling(entry)}>
                        Install
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Audit */}
          <div className="admin-section">
            <h3 className="admin-section-title">Audit</h3>
            {audit.length === 0 ? (
              <div className="admin-empty">No install history yet.</div>
            ) : (
              <div className="capability-list">
                {audit.map(([tool, success], idx) => (
                  <div key={`${tool}-${idx}`} className="capability-card">
                    <div className="capability-card-title">{tool}</div>
                    <Pill tone={success ? 'free' : 'new'}>
                      {success ? 'installed' : 'failed'}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 5. Gaps */}
          <div className="admin-section">
            <h3 className="admin-section-title">Gaps</h3>
            <form
              className="reports-log-gap-form"
              data-testid="capability-gap-form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleLogGap();
              }}
            >
              <div className="reports-log-gap-field">
                <label htmlFor="capability-gap-capability">Capability</label>
                <Input
                  id="capability-gap-capability"
                  type="text"
                  value={gapCapability}
                  onChange={(e) => setGapCapability(e.target.value)}
                  placeholder="e.g. send a calendar invite"
                  disabled={gapBusy}
                />
              </div>
              <div className="reports-log-gap-field" style={{ flex: '2 1 320px' }}>
                <label htmlFor="capability-gap-request">User request</label>
                <Input
                  id="capability-gap-request"
                  type="text"
                  value={gapRequest}
                  onChange={(e) => setGapRequest(e.target.value)}
                  placeholder="What was the user trying to do?"
                  disabled={gapBusy}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={gapBusy || !gapCapability.trim() || !gapRequest.trim()}
              >
                {gapBusy ? 'Logging…' : 'Log gap'}
              </Button>
            </form>
            {gaps.length === 0 ? (
              <div className="admin-empty">No gaps logged this session.</div>
            ) : (
              <div className="capability-list">
                {gaps.map((g) => (
                  <div key={g.id} className="capability-card">
                    <div className="capability-card-title">{g.capability}</div>
                    <div className="capability-card-description">{g.userRequest}</div>
                    <div className="capability-card-meta">logged {formatTs(g.loggedAt)}</div>
                    <div className="capability-card-actions">
                      <Button variant="secondary" size="sm" onClick={() => void handleResolveGap(g)}>
                        Resolve (immune)
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6. Self-critique */}
          <div className="admin-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="admin-section-title" style={{ margin: 0 }}>Self-critique</h3>
              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                <Button variant="ghost" size="sm" onClick={() => void handleWeeklyMeta()}>
                  Weekly meta
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRoastOpen(true)}>
                  Run deep roast
                </Button>
              </div>
            </div>
            {critiqueSummary.length === 0 ? (
              <div className="admin-empty">No critique history yet.</div>
            ) : (
              <div className="capability-list">
                {critiqueSummary.map((c) => (
                  <div key={c.id} className="capability-card" data-testid="self-critique-row">
                    <div className="capability-card-title">{c.user_request || 'Untitled'}</div>
                    <div className="capability-card-meta">{formatTs(c.created_at)}</div>
                    {c.improvement_summary ? (
                      <div className="capability-card-description">{c.improvement_summary}</div>
                    ) : null}
                    <pre className="capability-critique-pre">
                      {typeof c.critique === 'string'
                        ? c.critique
                        : JSON.stringify(c.critique, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7. Forge */}
          <div className="admin-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="admin-section-title" style={{ margin: 0 }}>Forge</h3>
              <Button variant="primary" size="sm" onClick={() => setForgeOpen(true)}>
                New tool
              </Button>
            </div>
            {tools.length === 0 ? (
              <div className="admin-empty">No forged tools yet.</div>
            ) : (
              <div className="capability-forge-grid">
                {tools.map((t) => (
                  <div key={t.id} className="capability-card" data-testid="forge-tool-card">
                    <div className="capability-card-title">{t.name}</div>
                    <div className="capability-card-meta">
                      {t.language} · {t.script_path.split(/[\\/]/).pop() ?? t.script_path}
                    </div>
                    <div className="capability-card-description">{t.description}</div>
                    <div className="capability-card-meta">{formatTs(t.created_at)}</div>
                    <div className="capability-card-actions">
                      <Button variant="secondary" size="sm" onClick={() => void handleTestTool(t)}>
                        Test
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTool(t)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Install suggestion dialog ──────────────────────────── */}
      <Dialog
        open={installSuggestion !== null}
        onClose={() => {
          if (!installBusy) {
            setInstallSuggestion(null);
            setInstallTokenKey('');
            setInstallTokenValue('');
          }
        }}
        ariaLabel="Install evolution suggestion"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirmInstall();
          }}
        >
          <h3 className="admin-dialog-heading">
            Install: {installSuggestion?.name ?? ''}
          </h3>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: 0 }}>
            {installSuggestion?.description}
          </p>
          {installSuggestion?.required_token_hint ? (
            <p style={{ color: 'var(--a-warm)', fontSize: 12, margin: 0 }}>
              Required token: {installSuggestion.required_token_hint}
            </p>
          ) : null}
          <div className="admin-dialog-field">
            <label htmlFor="install-token-key">Token key</label>
            <Input
              id="install-token-key"
              type="text"
              mono
              value={installTokenKey}
              onChange={(e) => setInstallTokenKey(e.target.value)}
              placeholder={installSuggestion?.required_token_hint ?? 'API_KEY'}
              disabled={installBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="install-token-value">Token value</label>
            <Input
              id="install-token-value"
              type="password"
              value={installTokenValue}
              onChange={(e) => setInstallTokenValue(e.target.value)}
              disabled={installBusy}
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setInstallSuggestion(null);
                setInstallTokenKey('');
                setInstallTokenValue('');
              }}
              disabled={installBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={installBusy}>
              {installBusy ? 'Installing…' : 'Install'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Catalog install confirm dialog ─────────────────────── */}
      <Dialog
        open={catalogInstalling !== null}
        onClose={() => {
          if (!catalogInstallBusy) setCatalogInstalling(null);
        }}
        ariaLabel="Confirm catalog install"
      >
        <div className="admin-dialog-body">
          <h3 className="admin-dialog-heading">Install capability</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            {catalogInstalling?.description}
          </p>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--t-1)',
              background: 'rgba(255,255,255,0.04)',
              padding: 'var(--s-2)',
              borderRadius: 'var(--r-sm)',
            }}
          >
            {catalogInstalling?.install_cmd}
          </code>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCatalogInstalling(null)}
              disabled={catalogInstallBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleConfirmCatalogInstall()}
              disabled={catalogInstallBusy}
            >
              {catalogInstallBusy ? 'Installing…' : 'Install'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── Deep-roast dialog ──────────────────────────────────── */}
      <Dialog
        open={roastOpen}
        onClose={() => {
          if (!roastBusy) setRoastOpen(false);
        }}
        ariaLabel="Run deep-roast critique"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleDeepRoast();
          }}
        >
          <h3 className="admin-dialog-heading">Deep roast</h3>
          <div className="admin-dialog-field">
            <label htmlFor="roast-request">User request</label>
            <textarea
              id="roast-request"
              value={roastRequest}
              onChange={(e) => setRoastRequest(e.target.value)}
              rows={3}
              disabled={roastBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="roast-response">Blade response</label>
            <textarea
              id="roast-response"
              value={roastResponse}
              onChange={(e) => setRoastResponse(e.target.value)}
              rows={5}
              disabled={roastBusy}
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRoastOpen(false)}
              disabled={roastBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={roastBusy || !roastRequest.trim() || !roastResponse.trim()}
            >
              {roastBusy ? 'Roasting…' : 'Roast'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Forge new-tool dialog ──────────────────────────────── */}
      <Dialog
        open={forgeOpen}
        onClose={() => {
          if (!forgeBusy) setForgeOpen(false);
        }}
        ariaLabel="Forge a new tool"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleNewTool();
          }}
        >
          <h3 className="admin-dialog-heading">New tool</h3>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: 0 }}>
            Describe the capability you need. BLADE synthesizes the script, definition, and usage.
          </p>
          <div className="admin-dialog-field">
            <label htmlFor="forge-capability">Capability description</label>
            <textarea
              id="forge-capability"
              value={forgeCapability}
              onChange={(e) => setForgeCapability(e.target.value)}
              rows={4}
              placeholder="e.g. Convert a PDF to plain text"
              disabled={forgeBusy}
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setForgeOpen(false)}
              disabled={forgeBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={forgeBusy || !forgeCapability.trim()}
            >
              {forgeBusy ? 'Forging…' : 'Forge'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Forge delete confirm dialog ────────────────────────── */}
      <Dialog
        open={deleteTool !== null}
        onClose={() => {
          if (!deleteBusy) setDeleteTool(null);
        }}
        ariaLabel="Confirm tool deletion"
      >
        <div className="admin-dialog-body">
          <h3 className="admin-dialog-heading">Delete tool</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            Permanently delete <strong>{deleteTool?.name}</strong>? This removes the forged script
            from disk and cannot be undone.
          </p>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTool(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleConfirmDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
