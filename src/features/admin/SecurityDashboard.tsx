// src/features/admin/SecurityDashboard.tsx — Plan 07-05 Task 2 (ADMIN-05 — SC-4).
//
// Real body per D-183 — hero card (securityOverview) + 4-tab layout
// persisted via prefs.admin.activeTab prefix 'sec:'.
//   - Alerts  — SecurityAlertsTab (securityOverview derived + check forms)
//   - Scans   — SecurityScansTab (network + files + audit + deps + code;
//               audit merged into scans per Plan 07-05 artifacts list)
//   - Policies — SecurityPoliciesTab (symbolic policy engine)
//   - Pentest — SecurityPentestTab (DANGER ZONE — Dialog + ALL-CAPS banner)
//
// SC-4 falsification: this component invokes securityOverview() on mount
// (Rust security_monitor::security_overview at security_monitor.rs:928) and
// renders the returned SecurityOverview as a traffic-light hero card +
// passes the overview payload to SecurityAlertsTab which surfaces
// active_alerts / network_suspicious / files_unprotected as severity cards.
//
// Hero status tokens:
//   - network_suspicious > 0 OR files_unprotected > 0 → status="failed"
//   - last_scan_ts == 0 (never scanned)               → status="running"
//   - otherwise                                       → status="complete"
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 2
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-183
// @see src-tauri/src/security_monitor.rs:928 security_overview (SC-4 source)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Pill, GlassSpinner, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import { securityOverview } from '@/lib/tauri/admin';
import type { SecurityOverview } from './types';
import { SecurityAlertsTab } from './SecurityAlertsTab';
import { SecurityScansTab } from './SecurityScansTab';
import { SecurityPoliciesTab } from './SecurityPoliciesTab';
import { SecurityPentestTab } from './SecurityPentestTab';
import './admin.css';
import './admin-rich-a.css';

type TabKey = 'alerts' | 'scans' | 'policies' | 'pentest';
const TAB_KEYS: TabKey[] = ['alerts', 'scans', 'policies', 'pentest'];
const TAB_LABEL: Record<TabKey, string> = {
  alerts: 'Alerts',
  scans: 'Scans & Audit',
  policies: 'Policies',
  pentest: 'Pentest',
};
const PREFIX = 'sec:';

function heroStatus(overview: SecurityOverview | null): 'running' | 'complete' | 'failed' {
  if (!overview) return 'running';
  if (overview.network_suspicious > 0 || overview.files_unprotected > 0) return 'failed';
  if (overview.last_scan_ts === 0) return 'running';
  return 'complete';
}

function formatLastScan(ts: number | null | undefined): string {
  if (!ts || ts === 0) return 'never';
  try {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function SecurityDashboard() {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();

  const activeTabRaw = (prefs['admin.activeTab'] as string) ?? '';
  const activeTab: TabKey = useMemo(() => {
    if (activeTabRaw.startsWith(PREFIX)) {
      const t = activeTabRaw.slice(PREFIX.length);
      if ((TAB_KEYS as string[]).includes(t)) return t as TabKey;
    }
    return 'alerts';
  }, [activeTabRaw]);

  const setTab = useCallback(
    (t: TabKey) => setPref('admin.activeTab', `${PREFIX}${t}`),
    [setPref],
  );

  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const out = await securityOverview();
      setOverview(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Security overview failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reloadOverview();
  }, [reloadOverview]);

  const status = heroStatus(overview);
  const activeAlerts = overview
    ? (overview.network_suspicious ?? 0) + (overview.files_unprotected ?? 0)
    : 0;

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="security-dashboard-root">
      <div className="admin-header">
        <div>
          <h2 className="admin-header-title">Security</h2>
          <div className="admin-header-meta">
            {loading
              ? 'Loading…'
              : overview
                ? `last scan ${formatLastScan(overview.last_scan_ts)}`
                : 'overview unavailable'}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void reloadOverview()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {/* Hero — SC-4 falsifier */}
      <div
        className="security-hero"
        data-status={status}
        data-testid="security-hero"
      >
        <h3 className="security-hero-title">
          {status === 'complete'
            ? 'All clear'
            : status === 'failed'
              ? 'Active alerts'
              : 'Awaiting scan'}
        </h3>
        <div className="security-hero-meta">
          <Pill
            tone={status === 'complete' ? 'free' : status === 'failed' ? 'new' : 'default'}
            dot
          >
            {activeAlerts} active alert{activeAlerts === 1 ? '' : 's'}
          </Pill>
          {loading ? (
            <GlassSpinner size={16} label="Refreshing" />
          ) : null}
          {overview ? (
            <>
              <span>
                network: {overview.network_suspicious}/{overview.network_total} suspicious
              </span>
              <span>
                files: {overview.files_unprotected}/{overview.files_found} unprotected
              </span>
            </>
          ) : null}
        </div>
        {overview?.summary ? (
          <div className="security-hero-summary">{overview.summary}</div>
        ) : null}
      </div>

      {/* Tab row */}
      <div className="admin-tabs">
        {TAB_KEYS.map((t) => (
          <button
            key={t}
            type="button"
            className="admin-tab-pill"
            data-active={activeTab === t}
            data-testid="security-tab"
            data-tab={t}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {activeTab === 'alerts' ? (
        !loading && overview && activeAlerts === 0 ? (
          <EmptyState
            label="No security alerts"
            description="BLADE runs background scans periodically."
          />
        ) : (
          <SecurityAlertsTab overview={overview} />
        )
      ) : activeTab === 'scans' ? (
        <SecurityScansTab />
      ) : activeTab === 'policies' ? (
        <SecurityPoliciesTab />
      ) : (
        <SecurityPentestTab />
      )}
    </GlassPanel>
  );
}
