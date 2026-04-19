// src/features/admin/SecurityAlertsTab.tsx — Plan 07-05 Task 2 (SC-4 falsifier).
//
// Alerts sub-tab of SecurityDashboard. Derives alerts from the parent-provided
// SecurityOverview + exposes three check forms:
//   - Check URL — securityCheckUrl({url}) returns risk/safe/flags/recommendation.
//   - Check breach — securityCheckBreach(email) returns breach list.
//   - Check password hash — securityCheckPasswordHash(hash) returns bool; UI
//     label explicitly warns: never enter real password (T-07-05-03).
//
// SC-4 falsification: the SecurityOverview prop piped down from
// SecurityDashboard carries active_alerts / network_suspicious /
// files_unprotected from security_monitor.rs::security_overview. Rendering
// those as severity-colored cards IS the "active alerts" surface ROADMAP
// Phase 7 SC-4 asserts.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 2
// @see src-tauri/src/security_monitor.rs::security_overview (SC-4 source)

import { useCallback, useState } from 'react';
import { Button, Input, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  securityCheckUrl,
  securityCheckBreach,
  securityCheckPasswordHash,
} from '@/lib/tauri/admin';
import type { SecurityOverview, UrlSafetyResult, BreachResult } from './types';

interface Props {
  overview: SecurityOverview | null;
}

export function SecurityAlertsTab({ overview }: Props) {
  const toast = useToast();

  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlResult, setUrlResult] = useState<UrlSafetyResult | null>(null);

  const [emailInput, setEmailInput] = useState('');
  const [breachBusy, setBreachBusy] = useState(false);
  const [breachResult, setBreachResult] = useState<BreachResult | null>(null);

  const [hashInput, setHashInput] = useState('');
  const [hashBusy, setHashBusy] = useState(false);
  const [hashResult, setHashResult] = useState<boolean | null>(null);

  const runUrl = useCallback(async () => {
    if (urlBusy || !urlInput.trim()) return;
    setUrlBusy(true);
    try {
      const out = await securityCheckUrl(urlInput.trim());
      setUrlResult(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'URL check failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUrlBusy(false);
    }
  }, [urlInput, urlBusy, toast]);

  const runBreach = useCallback(async () => {
    if (breachBusy || !emailInput.trim()) return;
    setBreachBusy(true);
    try {
      const out = await securityCheckBreach(emailInput.trim());
      setBreachResult(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Breach check failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBreachBusy(false);
    }
  }, [emailInput, breachBusy, toast]);

  const runHash = useCallback(async () => {
    if (hashBusy || !hashInput.trim()) return;
    setHashBusy(true);
    try {
      const out = await securityCheckPasswordHash(hashInput.trim());
      setHashResult(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Hash check failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setHashBusy(false);
    }
  }, [hashInput, hashBusy, toast]);

  return (
    <div data-testid="security-alerts-root">
      <h3 className="admin-section-title">Active alerts</h3>
      {overview ? (
        <>
          <div
            className="security-alert-card"
            data-severity={overview.network_suspicious > 0 ? 'critical' : 'info'}
            data-testid="security-alert-card"
          >
            <div className="admin-card-title">Network</div>
            <div className="admin-card-meta">
              {overview.network_suspicious} suspicious of {overview.network_total} connections
            </div>
          </div>
          <div
            className="security-alert-card"
            data-severity={overview.files_unprotected > 0 ? 'warn' : 'info'}
            data-testid="security-alert-card"
          >
            <div className="admin-card-title">Sensitive files</div>
            <div className="admin-card-meta">
              {overview.files_unprotected} unprotected of {overview.files_found} found
            </div>
          </div>
          <div className="security-alert-card" data-severity="info" data-testid="security-alert-card">
            <div className="admin-card-title">Summary</div>
            <div className="admin-card-meta">{overview.summary || '—'}</div>
          </div>
        </>
      ) : (
        <div className="admin-empty">Security overview not loaded.</div>
      )}

      <h3 className="admin-section-title">Check URL</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runUrl();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-url-input">URL to check</label>
          <Input
            id="sec-url-input"
            type="url"
            mono
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://suspicious.example.com"
            disabled={urlBusy}
            data-testid="security-check-url-input"
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={urlBusy || !urlInput.trim()}>
          {urlBusy ? 'Checking…' : 'Check'}
        </Button>
      </form>
      {urlResult ? (
        <div className="security-check-result">
          <div>
            <Pill tone={urlResult.safe ? 'free' : 'new'}>
              {urlResult.safe ? 'safe' : urlResult.risk_level || 'risky'}
            </Pill>
            {' '}for {urlResult.url}
          </div>
          {urlResult.flags.length > 0 ? (
            <div>flags: {urlResult.flags.join(', ')}</div>
          ) : null}
          {urlResult.recommendation ? (
            <div>recommendation: {urlResult.recommendation}</div>
          ) : null}
        </div>
      ) : null}

      <h3 className="admin-section-title">Check email breach</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runBreach();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-email-input">Email address</label>
          <Input
            id="sec-email-input"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
            disabled={breachBusy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={breachBusy || !emailInput.trim()}
        >
          {breachBusy ? 'Checking…' : 'Check'}
        </Button>
      </form>
      {breachResult ? (
        <div className="security-check-result">
          <div>
            <Pill tone={breachResult.breached ? 'new' : 'free'}>
              {breachResult.breached ? 'breached' : 'clean'}
            </Pill>
            {' '}— {breachResult.breach_count} breach
            {breachResult.breach_count === 1 ? '' : 'es'}
          </div>
        </div>
      ) : null}

      <h3 className="admin-section-title">Check password hash</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runHash();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-hash-input">Hash (SHA-1)</label>
          <Input
            id="sec-hash-input"
            type="text"
            mono
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder="5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8"
            disabled={hashBusy}
          />
          <div className="security-check-note">
            Never paste a real password. This field is for a precomputed SHA-1 hash only.
          </div>
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={hashBusy || !hashInput.trim()}>
          {hashBusy ? 'Checking…' : 'Check'}
        </Button>
      </form>
      {hashResult !== null ? (
        <div className="security-check-result">
          <Pill tone={hashResult ? 'new' : 'free'}>
            {hashResult ? 'pwned' : 'not found in breach corpora'}
          </Pill>
        </div>
      ) : null}
    </div>
  );
}
