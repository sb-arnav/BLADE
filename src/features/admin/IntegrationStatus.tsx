// src/features/admin/IntegrationStatus.tsx
//
// Admin cluster — IntegrationStatus route (ADMIN-08, D-184). Renders the flat
// integration_get_state() aggregate counts as four per-service cards (gmail
// / calendar / slack / github), each with a toggle (integration_toggle) and
// a "Poll now" button (integration_poll_now). Below the service cards, MCP
// servers sub-section renders mcp_get_servers + mcp_server_health per server.
//
// Production-looking services (gmail, slack, github) are Dialog-confirmed
// when toggling OFF per D-184; calendar is plain.
//
// Rust has no INTEGRATION_STATUS_CHANGED emit (Plan 07-01 audit) — falls back
// to polling on focus + after action.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-184
// @see src/lib/tauri/admin.ts (integration* + mcpGetServers + mcpServerHealth)

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  integrationGetState,
  integrationPollNow,
  integrationToggle,
  mcpGetServers,
  mcpServerHealth,
} from '@/lib/tauri/admin';
import type {
  IntegrationState,
  McpServerHealth,
  McpServerInfo,
} from './types';
import './admin.css';
import './admin-rich-b.css';

interface ServiceRow {
  service: 'gmail' | 'calendar' | 'slack' | 'github';
  label: string;
  signal: number; // derived chip (unread/events/mentions/notifications)
  signalLabel: string;
  /** Toggling OFF requires a Dialog confirm for production-looking services. */
  confirmOff: boolean;
}

function deriveServices(state: IntegrationState | null): ServiceRow[] {
  return [
    {
      service: 'gmail',
      label: 'Gmail',
      signal: state?.unread_emails ?? 0,
      signalLabel: 'unread',
      confirmOff: true,
    },
    {
      service: 'calendar',
      label: 'Calendar',
      signal: state?.upcoming_events?.length ?? 0,
      signalLabel: 'upcoming',
      confirmOff: false,
    },
    {
      service: 'slack',
      label: 'Slack',
      signal: state?.slack_mentions ?? 0,
      signalLabel: 'mentions',
      confirmOff: true,
    },
    {
      service: 'github',
      label: 'GitHub',
      signal: state?.github_notifications ?? 0,
      signalLabel: 'notifications',
      confirmOff: true,
    },
  ];
}

function formatTimestamp(ts?: number): string {
  if (!ts) return 'never';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function IntegrationStatus() {
  const [state, setState] = useState<IntegrationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    gmail: true,
    calendar: true,
    slack: true,
    github: true,
  });
  const [pollingService, setPollingService] = useState<string | null>(null);
  const [togglingService, setTogglingService] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ServiceRow | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerInfo[] | null>(null);
  const [mcpHealth, setMcpHealth] = useState<McpServerHealth[] | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const toast = useToast();

  const refreshState = useCallback(async () => {
    try {
      const s = await integrationGetState();
      setState(s);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  const refreshMcp = useCallback(async () => {
    try {
      const [servers, health] = await Promise.all([mcpGetServers(), mcpServerHealth()]);
      setMcpServers(servers);
      setMcpHealth(health);
      setMcpError(null);
    } catch (e) {
      setMcpError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshState();
    void refreshMcp();
  }, [refreshState, refreshMcp]);

  const performToggle = useCallback(
    async (service: string, nextEnabled: boolean) => {
      setTogglingService(service);
      try {
        await integrationToggle({ service, enabled: nextEnabled });
        setEnabled((prev) => ({ ...prev, [service]: nextEnabled }));
        toast.show({
          type: 'success',
          title: nextEnabled ? 'Enabled' : 'Disabled',
          message: service,
        });
        await refreshState();
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Toggle failed',
          message: typeof e === 'string' ? e : String(e),
        });
      } finally {
        setTogglingService(null);
      }
    },
    [refreshState, toast],
  );

  const handleToggleClick = useCallback(
    (row: ServiceRow) => {
      const nowEnabled = enabled[row.service] ?? true;
      if (nowEnabled && row.confirmOff) {
        setConfirmTarget(row);
        return;
      }
      void performToggle(row.service, !nowEnabled);
    },
    [enabled, performToggle],
  );

  const confirmDisable = useCallback(async () => {
    if (!confirmTarget) return;
    const row = confirmTarget;
    setConfirmTarget(null);
    await performToggle(row.service, false);
  }, [confirmTarget, performToggle]);

  const pollNow = useCallback(
    async (service: string) => {
      setPollingService(service);
      try {
        const s = await integrationPollNow(service);
        setState(s);
        toast.show({ type: 'success', title: 'Polled', message: service });
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Poll failed',
          message: typeof e === 'string' ? e : String(e),
        });
      } finally {
        setPollingService(null);
      }
    },
    [toast],
  );

  const rows = deriveServices(state);
  const healthByName = new Map<string, McpServerHealth>();
  (mcpHealth ?? []).forEach((h) => healthByName.set(h.name, h));

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="integration-status-root">
      <div className="integration-layout">
        <section className="diagnostics-hero">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h3>Integrations</h3>
            <Button variant="ghost" onClick={refreshState}>
              Refresh
            </Button>
          </div>
          {error && <p className="admin-empty">Error: {error}</p>}
          <div className="admin-card-secondary">
            Last updated {formatTimestamp(state?.last_updated)}
          </div>
        </section>

        <section className="diagnostics-section">
          <h4 className="diagnostics-section-title">Services</h4>
          <div className="admin-row-list">
            {rows.map((row) => {
              const isEnabled = enabled[row.service] ?? true;
              const polling = pollingService === row.service;
              const toggling = togglingService === row.service;
              return (
                <div
                  key={row.service}
                  className="integration-service-card"
                  data-testid="integration-service-card"
                  data-service={row.service}
                >
                  <div className="integration-service-card-main">
                    <span className="integration-service-card-name">{row.label}</span>
                    <span className="integration-service-card-meta">
                      {row.signal} {row.signalLabel}
                    </span>
                  </div>
                  <div className="integration-service-card-actions">
                    <Pill tone={isEnabled ? 'free' : 'default'}>
                      {isEnabled ? 'enabled' : 'disabled'}
                    </Pill>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleClick(row)}
                      disabled={toggling}
                      data-testid="integration-toggle"
                    >
                      {toggling ? '…' : isEnabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => pollNow(row.service)}
                      disabled={polling}
                      data-testid="integration-poll-now"
                    >
                      {polling ? (
                        <>
                          <GlassSpinner /> Polling…
                        </>
                      ) : (
                        'Poll now'
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="diagnostics-section">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h4 className="diagnostics-section-title">MCP servers</h4>
            <Button variant="ghost" size="sm" onClick={refreshMcp}>
              Refresh
            </Button>
          </div>
          {mcpError && <p className="admin-empty">Error: {mcpError}</p>}
          <div className="admin-row-list">
            {(mcpServers ?? []).map((s) => {
              const h = healthByName.get(s.name);
              return (
                <div key={s.name} className="integration-service-card">
                  <div className="integration-service-card-main">
                    <span className="integration-service-card-name">{s.name}</span>
                    <span className="integration-service-card-meta">
                      tools {h?.tool_count ?? '?'} • reconnects {h?.reconnect_attempts ?? 0}
                    </span>
                  </div>
                  <div className="integration-service-card-actions">
                    <Pill
                      tone={h?.connected ? 'free' : 'default'}
                      data-testid="mcp-health-chip"
                    >
                      {h?.connected ? 'connected' : 'offline'}
                    </Pill>
                  </div>
                </div>
              );
            })}
            {mcpServers && mcpServers.length === 0 && (
              <p className="admin-empty">No MCP servers configured.</p>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        ariaLabel="Disable integration"
      >
        <div className="danger-banner">
          Disabling {confirmTarget?.label} stops background polling and drops live signal.
        </div>
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Disable {confirmTarget?.label}?</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
          Re-enable any time from this page.
        </p>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setConfirmTarget(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmDisable}>
            Disable
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
