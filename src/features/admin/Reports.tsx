// src/features/admin/Reports.tsx — Plan 07-05 Task 1 (P-03 synthetic).
//
// Real body per D-182 + D-185 (Discretion — show source column):
//   - getReports(limit?) — reverse-chrono cards with source chip + status chip.
//   - Detail pane for selected report with "Mark investigating" and "Mark
//     resolved" Dialog-gated state transitions.
//   - "Log gap" inline form (manual entry point) → reportGap({ ... }).
//     Automatic entry point is backend capability_gap_detected → openRoute
//     ('reports') (Phase 1 P-03).
//   - Footer webhook config — getReportWebhook() + Dialog-gated setReport
//     Webhook({url}) with client-side http(s) regex validation.
//
// Rust shape corrections (per Plan 07-02 SUMMARY):
//   - reportGap takes a struct: { category, title, description, user_request,
//     blade_response, suggested_fix, severity }. The UI form collects the
//     subset the user can reasonably fill in; we fill the remaining fields
//     with sensible defaults so the Rust signature is satisfied.
//   - updateReportStatus takes { id, status }.
//   - setReportWebhook takes a flat url: string.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-182, §D-185
// @see src/lib/tauri/admin.ts (getReports, reportGap, updateReportStatus,
//      setReportWebhook, getReportWebhook)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, Input, GlassSpinner, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  getReports,
  reportGap,
  updateReportStatus,
  setReportWebhook,
  getReportWebhook,
} from '@/lib/tauri/admin';
import type { Report } from './types';
import './admin.css';
import './admin-rich-a.css';

const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

function formatTs(ts: number): string {
  try {
    // reports.reported_at is seconds-since-epoch in Rust today; be tolerant.
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** Normalize category into a display source per D-185. */
function reportSource(r: Report): string {
  if (r.category === 'capability_gap_detected' || r.category === 'capability_gap') {
    return 'auto';
  }
  if (r.category && r.category.length > 0) return r.category;
  return 'manual';
}

export function Reports() {
  const toast = useToast();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Log-gap form
  const [gapTitle, setGapTitle] = useState('');
  const [gapSummary, setGapSummary] = useState('');
  const [gapBusy, setGapBusy] = useState(false);

  // Status transition dialog
  const [statusTarget, setStatusTarget] = useState<{ id: string; nextStatus: string } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // Webhook state
  const [webhook, setWebhook] = useState<string>('');
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [webhookBusy, setWebhookBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([getReports(200), getReportWebhook()]);
    if (results[0].status === 'fulfilled') {
      const rows = results[0].value.slice().sort((a, b) => b.reported_at - a.reported_at);
      setReports(rows);
    }
    if (results[1].status === 'fulfilled') setWebhook(results[1].value);

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some report data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  const handleLogGap = useCallback(async () => {
    if (gapBusy) return;
    const title = gapTitle.trim();
    const summary = gapSummary.trim();
    if (!title && !summary) return;
    setGapBusy(true);
    try {
      // Rust signature requires all 7 fields; fill what the UI doesn't collect
      // with honest defaults. The display column derives `source='manual'`
      // from category='manual_log' per D-185.
      await reportGap({
        category: 'manual_log',
        title: title || summary.slice(0, 80),
        description: summary || title,
        userRequest: summary || title,
        bladeResponse: '',
        suggestedFix: '',
        severity: 'medium',
      });
      toast.show({ type: 'success', title: 'Gap reported' });
      setGapTitle('');
      setGapSummary('');
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Log gap failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGapBusy(false);
    }
  }, [gapBusy, gapTitle, gapSummary, toast, loadAll]);

  const handleConfirmStatus = useCallback(async () => {
    if (!statusTarget || statusBusy) return;
    setStatusBusy(true);
    try {
      await updateReportStatus({ id: statusTarget.id, status: statusTarget.nextStatus });
      toast.show({
        type: 'success',
        title: `Marked ${statusTarget.nextStatus}`,
      });
      setStatusTarget(null);
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Status update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setStatusBusy(false);
    }
  }, [statusTarget, statusBusy, toast, loadAll]);

  const handleSaveWebhook = useCallback(async () => {
    if (webhookBusy) return;
    const url = webhookDraft.trim();
    if (url.length > 0 && !URL_RE.test(url)) {
      toast.show({
        type: 'error',
        title: 'Invalid webhook URL',
        message: 'Must start with http:// or https://',
      });
      return;
    }
    setWebhookBusy(true);
    try {
      await setReportWebhook(url);
      setWebhook(url);
      setWebhookOpen(false);
      toast.show({
        type: 'success',
        title: url ? 'Webhook updated' : 'Webhook cleared',
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Save webhook failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWebhookBusy(false);
    }
  }, [webhookBusy, webhookDraft, toast]);

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="reports-root">
      <div className="admin-header">
        <div>
          <h2 className="admin-header-title">Reports</h2>
          <div className="admin-header-meta">
            {loading ? 'Loading…' : `${reports.length} report${reports.length === 1 ? '' : 's'}`}
            {' · source column shows manual vs capability_gap_detected (D-185)'}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadAll()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {/* Log-gap form */}
      <form
        className="reports-log-gap-form"
        data-testid="report-log-gap-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleLogGap();
        }}
      >
        <div className="reports-log-gap-field">
          <label htmlFor="report-gap-title">Title</label>
          <Input
            id="report-gap-title"
            type="text"
            value={gapTitle}
            onChange={(e) => setGapTitle(e.target.value)}
            placeholder="Short title"
            disabled={gapBusy}
          />
        </div>
        <div className="reports-log-gap-field" style={{ flex: '2 1 320px' }}>
          <label htmlFor="report-gap-summary">Summary</label>
          <Input
            id="report-gap-summary"
            type="text"
            value={gapSummary}
            onChange={(e) => setGapSummary(e.target.value)}
            placeholder="What happened?"
            disabled={gapBusy}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={gapBusy || (!gapTitle.trim() && !gapSummary.trim())}
        >
          {gapBusy ? 'Logging…' : 'Log gap'}
        </Button>
      </form>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading reports" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          label="BLADE is still scanning your capabilities"
          description="Reports will appear after BLADE runs scheduled scans — give me 24h."
        />
      ) : (
        <div className="reports-layout">
          <div className="reports-list" data-testid="reports-list">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                className="report-row"
                data-testid="report-row"
                data-selected={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="report-row-title">{r.title || 'Untitled report'}</div>
                <div className="report-row-meta">
                  <span className="report-source-chip">{reportSource(r)}</span>
                  <span className="report-status-chip" data-status={r.status}>
                    {r.status}
                  </span>
                  <span className="admin-header-meta">{formatTs(r.reported_at)}</span>
                  {r.severity ? (
                    <span className="admin-header-meta">· {r.severity}</span>
                  ) : null}
                </div>
                {r.description ? (
                  <div className="report-row-summary">
                    {r.description.length > 140 ? `${r.description.slice(0, 140)}…` : r.description}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          <div className="report-detail" data-testid="report-detail">
            {selected ? (
              <>
                <div>
                  <div className="admin-header-title" style={{ fontSize: 18 }}>
                    {selected.title || 'Untitled report'}
                  </div>
                  <div className="report-row-meta">
                    <span className="report-source-chip">{reportSource(selected)}</span>
                    <span className="report-status-chip" data-status={selected.status}>
                      {selected.status}
                    </span>
                    <span className="admin-header-meta">{formatTs(selected.reported_at)}</span>
                  </div>
                </div>
                <div>
                  <p className="report-detail-section-title">Description</p>
                  <p className="report-detail-section-body">{selected.description || '—'}</p>
                </div>
                <div>
                  <p className="report-detail-section-title">User request</p>
                  <p className="report-detail-section-body">{selected.user_request || '—'}</p>
                </div>
                {selected.blade_response ? (
                  <div>
                    <p className="report-detail-section-title">Blade response</p>
                    <p className="report-detail-section-body">{selected.blade_response}</p>
                  </div>
                ) : null}
                {selected.suggested_fix ? (
                  <div>
                    <p className="report-detail-section-title">Suggested fix</p>
                    <p className="report-detail-section-body">{selected.suggested_fix}</p>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={selected.status === 'investigating'}
                    onClick={() => setStatusTarget({ id: selected.id, nextStatus: 'investigating' })}
                    data-testid="report-status-button"
                  >
                    Mark investigating
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={selected.status === 'resolved'}
                    onClick={() => setStatusTarget({ id: selected.id, nextStatus: 'resolved' })}
                  >
                    Mark resolved
                  </Button>
                </div>
              </>
            ) : (
              <div className="admin-empty">Select a report to inspect.</div>
            )}
          </div>
        </div>
      )}

      <div className="reports-webhook-footer">
        <div style={{ color: 'var(--t-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Webhook
        </div>
        <div className="reports-webhook-url" data-testid="report-webhook-input">
          {webhook && webhook.length > 0 ? webhook : '— no webhook configured —'}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setWebhookDraft(webhook ?? '');
            setWebhookOpen(true);
          }}
        >
          Set webhook…
        </Button>
      </div>

      {/* ─── Status transition confirm dialog ────────────────────── */}
      <Dialog
        open={statusTarget !== null}
        onClose={() => {
          if (!statusBusy) setStatusTarget(null);
        }}
        ariaLabel="Confirm report status change"
      >
        <div className="admin-dialog-body">
          <h3 className="admin-dialog-heading">Mark {statusTarget?.nextStatus}</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            Update the report status to <strong>{statusTarget?.nextStatus}</strong>?
          </p>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStatusTarget(null)}
              disabled={statusBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleConfirmStatus()}
              disabled={statusBusy}
            >
              {statusBusy ? 'Updating…' : 'Confirm'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ─── Webhook dialog ──────────────────────────────────────── */}
      <Dialog
        open={webhookOpen}
        onClose={() => {
          if (!webhookBusy) setWebhookOpen(false);
        }}
        ariaLabel="Configure report webhook"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveWebhook();
          }}
        >
          <h3 className="admin-dialog-heading">Report webhook</h3>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: 0 }}>
            Every capability-gap report POSTs to this URL. Leave blank to disable.
          </p>
          <div className="admin-dialog-field">
            <label htmlFor="report-webhook-url">Webhook URL</label>
            <Input
              id="report-webhook-url"
              type="url"
              mono
              value={webhookDraft}
              onChange={(e) => setWebhookDraft(e.target.value)}
              placeholder="https://example.com/hook"
              disabled={webhookBusy}
              autoFocus
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWebhookOpen(false)}
              disabled={webhookBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                webhookBusy ||
                (webhookDraft.trim().length > 0 && !URL_RE.test(webhookDraft.trim()))
              }
            >
              {webhookBusy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassPanel>
  );
}
