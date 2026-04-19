// src/features/admin/SecurityScansTab.tsx — Plan 07-05 Task 2.
//
// Scans + Audit sub-tab (merged per 07-05 PLAN frontmatter artifacts list —
// "Security Scans + Audit sub-tab (merged for density)").
//
// Surfaces 5 actions:
//   - Run network scan — securityScanNetwork() → NetworkConnection[] table.
//   - Scan sensitive files — securityScanSensitiveFiles() → SensitiveFile[] table.
//   - Run full audit — securityRunAudit(scope) → SecurityReport card.
//   - Deps audit — securityAuditDeps(projectPath) → DepVulnerability[] table.
//   - Code scan — securityScanCode(filePath) → SecurityIssue[] table.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 2
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-183

import { useCallback, useState } from 'react';
import { Button, Input, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  securityScanNetwork,
  securityScanSensitiveFiles,
  securityRunAudit,
  securityAuditDeps,
  securityScanCode,
} from '@/lib/tauri/admin';
import type {
  NetworkConnection,
  SensitiveFile,
  SecurityReport,
  DepVulnerability,
  SecurityIssue,
} from './types';

function severityNormalized(s: string | undefined): string {
  const v = (s ?? '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  return 'low';
}

export function SecurityScansTab() {
  const toast = useToast();

  const [networkBusy, setNetworkBusy] = useState(false);
  const [network, setNetwork] = useState<NetworkConnection[]>([]);

  const [filesBusy, setFilesBusy] = useState(false);
  const [files, setFiles] = useState<SensitiveFile[]>([]);

  const [auditBusy, setAuditBusy] = useState(false);
  const [auditScope, setAuditScope] = useState('system');
  const [auditReport, setAuditReport] = useState<SecurityReport | null>(null);

  const [depsBusy, setDepsBusy] = useState(false);
  const [depsPath, setDepsPath] = useState('');
  const [deps, setDeps] = useState<DepVulnerability[]>([]);

  const [codeBusy, setCodeBusy] = useState(false);
  const [codePath, setCodePath] = useState('');
  const [codeIssues, setCodeIssues] = useState<SecurityIssue[]>([]);

  const runNetwork = useCallback(async () => {
    if (networkBusy) return;
    setNetworkBusy(true);
    try {
      const out = await securityScanNetwork();
      setNetwork(out);
      toast.show({ type: 'success', title: `Network scan: ${out.length} connections` });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Network scan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setNetworkBusy(false);
    }
  }, [networkBusy, toast]);

  const runFiles = useCallback(async () => {
    if (filesBusy) return;
    setFilesBusy(true);
    try {
      const out = await securityScanSensitiveFiles();
      setFiles(out);
      toast.show({ type: 'success', title: `Sensitive files: ${out.length} found` });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'File scan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFilesBusy(false);
    }
  }, [filesBusy, toast]);

  const runAudit = useCallback(async () => {
    if (auditBusy) return;
    const scope = auditScope.trim() || 'system';
    setAuditBusy(true);
    try {
      const out = await securityRunAudit(scope);
      setAuditReport(out);
      toast.show({ type: 'success', title: 'Audit complete', message: scope });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Audit failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAuditBusy(false);
    }
  }, [auditBusy, auditScope, toast]);

  const runDeps = useCallback(async () => {
    if (depsBusy || !depsPath.trim()) return;
    setDepsBusy(true);
    try {
      const out = await securityAuditDeps(depsPath.trim());
      setDeps(out);
      toast.show({ type: 'success', title: `Deps audit: ${out.length} vuln(s)` });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Deps audit failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDepsBusy(false);
    }
  }, [depsBusy, depsPath, toast]);

  const runCode = useCallback(async () => {
    if (codeBusy || !codePath.trim()) return;
    setCodeBusy(true);
    try {
      const out = await securityScanCode(codePath.trim());
      setCodeIssues(out);
      toast.show({ type: 'success', title: `Code scan: ${out.length} issue(s)` });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Code scan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCodeBusy(false);
    }
  }, [codeBusy, codePath, toast]);

  return (
    <div data-testid="security-scans-root">
      {/* Network + sensitive files */}
      <h3 className="admin-section-title">System scans</h3>
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', marginBottom: 'var(--s-3)' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void runNetwork()}
          disabled={networkBusy}
          data-testid="security-scan-button"
        >
          {networkBusy ? 'Scanning…' : 'Run network scan'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void runFiles()}
          disabled={filesBusy}
          data-testid="security-scan-button"
        >
          {filesBusy ? 'Scanning…' : 'Scan sensitive files'}
        </Button>
      </div>

      {network.length > 0 ? (
        <div className="security-findings-table" data-testid="security-findings-table">
          {network.map((c, idx) => (
            <div
              key={`net-${idx}`}
              className="security-finding-row"
              data-severity={c.suspicious ? 'high' : 'low'}
            >
              <span className="security-finding-sev">{c.suspicious ? 'suspicious' : 'ok'}</span>
              <span className="security-finding-desc">
                {c.protocol} {c.local_addr} → {c.remote_addr}
              </span>
              <span className="security-finding-meta">{c.state}</span>
            </div>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="security-findings-table" data-testid="security-findings-table">
          {files.map((f, idx) => (
            <div
              key={`file-${idx}`}
              className="security-finding-row"
              data-severity={severityNormalized(f.risk)}
            >
              <span className="security-finding-sev">{f.risk}</span>
              <span className="security-finding-desc">{f.path}</span>
              <span className="security-finding-meta">{f.category}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Audit section */}
      <h3 className="admin-section-title">Audit</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runAudit();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-audit-scope">Scope</label>
          <Input
            id="sec-audit-scope"
            type="text"
            value={auditScope}
            onChange={(e) => setAuditScope(e.target.value)}
            placeholder="system / project / user"
            disabled={auditBusy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={auditBusy}
          data-testid="security-scan-button"
        >
          {auditBusy ? 'Running…' : 'Run full audit'}
        </Button>
      </form>
      {auditBusy ? (
        <div style={{ padding: 'var(--s-3)' }}>
          <GlassSpinner size={20} label="Running full audit" />
        </div>
      ) : auditReport ? (
        <div className="admin-card" style={{ marginTop: 'var(--s-2)' }}>
          <div className="admin-card-title">Audit report · {auditReport.scope}</div>
          <div className="admin-card-meta">
            {new Date(auditReport.started_at).toLocaleString()} →{' '}
            {new Date(auditReport.finished_at).toLocaleString()}
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--t-2)',
              margin: 0,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {auditReport.report || auditReport.analysis_findings || auditReport.recon_findings || '—'}
          </pre>
        </div>
      ) : null}

      {/* Deps audit */}
      <h3 className="admin-section-title">Deps audit</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runDeps();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-deps-path">Project path</label>
          <Input
            id="sec-deps-path"
            type="text"
            mono
            value={depsPath}
            onChange={(e) => setDepsPath(e.target.value)}
            placeholder="/path/to/project"
            disabled={depsBusy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={depsBusy || !depsPath.trim()}
          data-testid="security-scan-button"
        >
          {depsBusy ? 'Auditing…' : 'Audit deps'}
        </Button>
      </form>
      {deps.length > 0 ? (
        <div className="security-findings-table" data-testid="security-findings-table">
          {deps.map((v, idx) => (
            <div
              key={`dep-${idx}`}
              className="security-finding-row"
              data-severity={severityNormalized(v.severity)}
            >
              <span className="security-finding-sev">{v.severity}</span>
              <span className="security-finding-desc">
                {v.package}@{v.installed_version}: {v.title}
              </span>
              <span className="security-finding-meta">
                {v.cve ?? v.ecosystem}
                {v.fix_version ? ` · fix ${v.fix_version}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Code scan */}
      <h3 className="admin-section-title">Code scan</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runCode();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-code-path">File path</label>
          <Input
            id="sec-code-path"
            type="text"
            mono
            value={codePath}
            onChange={(e) => setCodePath(e.target.value)}
            placeholder="/path/to/file.py"
            disabled={codeBusy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={codeBusy || !codePath.trim()}
          data-testid="security-scan-button"
        >
          {codeBusy ? 'Scanning…' : 'Scan'}
        </Button>
      </form>
      {codeIssues.length > 0 ? (
        <div className="security-findings-table" data-testid="security-findings-table">
          {codeIssues.map((i, idx) => (
            <div
              key={`code-${idx}`}
              className="security-finding-row"
              data-severity={severityNormalized(i.severity)}
            >
              <span className="security-finding-sev">{i.severity}</span>
              <span className="security-finding-desc">
                {i.issue_type}: {i.description}
              </span>
              <span className="security-finding-meta">
                {i.file_path}
                {i.line_number ? `:${i.line_number}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
