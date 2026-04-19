// src/features/admin/DecisionLog.tsx — Plan 07-05 Task 2 (ADMIN-04 — SC-3).
//
// Real body per D-182 — tabbed surface persisted via prefs.admin.activeTab
// prefix 'dlog:':
//   1. Decisions tab — getDecisionLog({limit:100}) reverse-chrono list;
//      Evaluate panel at top invokes decisionEvaluate({ source, description,
//      confidence, reversible }) for debugging; per-row Feedback dialog →
//      decisionFeedback({ id, wasCorrect }).
//   2. Authority tab — authorityGetAuditLog() + authorityGetDelegations()
//      two-list surface.
//   3. Audit tab — auditGetLog({limit:100}) global audit entry list.
//
// SC-3 falsification: this component invokes getDecisionLog (Rust
// decision_gate::get_decision_log at decision_gate.rs:376) and surfaces the
// returned DecisionRecord ring buffer as a reverse-chrono list with the
// Feedback → decision_feedback write-back and Evaluate → decision_evaluate
// debug surface.
//
// Rust shape corrections (per Plan 07-02 SUMMARY):
//   - getDecisionLog takes no args (hardcoded 20-record ring buffer) — the
//     wrapper accepts an optional limit but ignores it.
//   - decisionFeedback takes { id, wasCorrect } only (no `note` field in
//     Rust). The plan called for an optional note but the Rust signature
//     has no slot for it — we drop the UI field per Rule 1 auto-fix.
//   - decisionEvaluate takes { source, description, confidence, reversible }
//     (four fields, not a single `signal` string). The UI surfaces these
//     four inputs.
//   - DecisionLogEntry.signal / outcome are opaque JSON values; we render
//     them as best-effort strings.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 2
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-182
// @see src-tauri/src/decision_gate.rs:376 get_decision_log (SC-3 source)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, Input, Pill, EmptyState } from '@/design-system/primitives';
import { ListSkeleton } from '@/design-system/primitives/ListSkeleton';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  getDecisionLog,
  decisionFeedback,
  decisionEvaluate,
  authorityGetAuditLog,
  authorityGetDelegations,
  auditGetLog,
} from '@/lib/tauri/admin';
import type {
  DecisionLogEntry,
  AuthorityAuditEntry,
  AuthorityDelegation,
  AuditLogEntry,
} from './types';
import './admin.css';
import './admin-rich-a.css';

type TabKey = 'decisions' | 'authority' | 'audit';
const TAB_KEYS: TabKey[] = ['decisions', 'authority', 'audit'];
const TAB_LABEL: Record<TabKey, string> = {
  decisions: 'Decisions',
  authority: 'Authority',
  audit: 'Audit',
};
const PREFIX = 'dlog:';

function formatTs(ts: number): string {
  try {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** Best-effort stringification of opaque signal/outcome JSON values. */
function stringifyOpaque(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Try to extract the decision `type` out of a signal/outcome blob. */
function extractSignalType(v: unknown): string {
  if (!v || typeof v !== 'object') return 'unknown';
  const obj = v as Record<string, unknown>;
  for (const k of ['type', 'kind', 'source', 'category']) {
    const val = obj[k];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return 'signal';
}

/** Try to extract decision outcome (act/ask/queue/ignore) out of the blob. */
function extractOutcome(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.toLowerCase();
  if (typeof v !== 'object') return '—';
  const obj = v as Record<string, unknown>;
  for (const k of ['action', 'decision', 'outcome', 'type', 'kind']) {
    const val = obj[k];
    if (typeof val === 'string' && val.length > 0) return val.toLowerCase();
  }
  return '—';
}

/** Try to extract confidence from the signal blob (0–1 scalar). */
function extractConfidence(v: unknown): number | null {
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  for (const k of ['confidence', 'conf', 'score']) {
    const val = obj[k];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
  }
  return null;
}

export function DecisionLog() {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();

  const activeTabRaw = (prefs['admin.activeTab'] as string) ?? '';
  const activeTab: TabKey = useMemo(() => {
    if (activeTabRaw.startsWith(PREFIX)) {
      const t = activeTabRaw.slice(PREFIX.length);
      if ((TAB_KEYS as string[]).includes(t)) return t as TabKey;
    }
    return 'decisions';
  }, [activeTabRaw]);

  const setTab = useCallback(
    (t: TabKey) => setPref('admin.activeTab', `${PREFIX}${t}`),
    [setPref],
  );

  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);
  const [authorityAudit, setAuthorityAudit] = useState<AuthorityAuditEntry[]>([]);
  const [delegations, setDelegations] = useState<AuthorityDelegation[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Evaluate panel
  const [evalSource, setEvalSource] = useState('');
  const [evalDescription, setEvalDescription] = useState('');
  const [evalConfidence, setEvalConfidence] = useState('0.8');
  const [evalReversible, setEvalReversible] = useState(true);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  // Feedback dialog
  const [feedbackRow, setFeedbackRow] = useState<DecisionLogEntry | null>(null);
  const [feedbackCorrect, setFeedbackCorrect] = useState<boolean | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      getDecisionLog({ limit: 100 }),
      authorityGetAuditLog(100),
      authorityGetDelegations(50),
      auditGetLog({ limit: 100 }),
    ]);
    if (results[0].status === 'fulfilled') setDecisions(results[0].value);
    if (results[1].status === 'fulfilled') setAuthorityAudit(results[1].value);
    if (results[2].status === 'fulfilled') setDelegations(results[2].value);
    if (results[3].status === 'fulfilled') setAuditEntries(results[3].value);

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some decision log data could not load',
        message:
          firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleEvaluate = useCallback(async () => {
    if (evalBusy) return;
    const source = evalSource.trim();
    const description = evalDescription.trim();
    const confidence = Number(evalConfidence);
    if (!source || !description || !Number.isFinite(confidence)) return;
    setEvalBusy(true);
    setEvalResult(null);
    try {
      const out = await decisionEvaluate({
        source,
        description,
        confidence,
        reversible: evalReversible,
      });
      setEvalResult(out);
      toast.show({ type: 'success', title: 'Decision evaluated' });
      // Refresh log so the new entry shows up.
      const fresh = await getDecisionLog({ limit: 100 });
      setDecisions(fresh);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Evaluate failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEvalBusy(false);
    }
  }, [evalBusy, evalSource, evalDescription, evalConfidence, evalReversible, toast]);

  const handleConfirmFeedback = useCallback(async () => {
    if (!feedbackRow || feedbackCorrect === null || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      await decisionFeedback({ id: feedbackRow.id, wasCorrect: feedbackCorrect });
      toast.show({ type: 'success', title: 'Feedback recorded' });
      setFeedbackRow(null);
      setFeedbackCorrect(null);
      const fresh = await getDecisionLog({ limit: 100 });
      setDecisions(fresh);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Feedback failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFeedbackBusy(false);
    }
  }, [feedbackRow, feedbackCorrect, feedbackBusy, toast]);

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="decision-log-root">
      <div className="admin-header">
        <div>
          <h2 className="admin-header-title">Decision Log</h2>
          <div className="admin-header-meta">
            {loading
              ? 'Loading…'
              : `${decisions.length} decisions · ${authorityAudit.length} authority entries · ${auditEntries.length} audit`}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadAll()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {/* Tab row */}
      <div className="admin-tabs">
        {TAB_KEYS.map((t) => (
          <button
            key={t}
            type="button"
            className="admin-tab-pill"
            data-active={activeTab === t}
            data-testid="decision-log-tab"
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : activeTab === 'decisions' ? (
        <>
          {/* Evaluate panel */}
          <div className="decision-evaluate-panel">
            <h3 className="admin-section-title" style={{ margin: 0 }}>Evaluate (debug)</h3>
            <p className="admin-section-subtitle">
              Submits a synthetic signal to the decision gate for classification.
            </p>
            <div className="decision-evaluate-grid">
              <div className="admin-dialog-field">
                <label htmlFor="dlog-eval-source">Source</label>
                <Input
                  id="dlog-eval-source"
                  type="text"
                  value={evalSource}
                  onChange={(e) => setEvalSource(e.target.value)}
                  placeholder="clipboard / proactive / user"
                  disabled={evalBusy}
                />
              </div>
              <div className="admin-dialog-field" style={{ flex: '2 1 260px' }}>
                <label htmlFor="dlog-eval-desc">Description</label>
                <Input
                  id="dlog-eval-desc"
                  type="text"
                  value={evalDescription}
                  onChange={(e) => setEvalDescription(e.target.value)}
                  placeholder="What is the signal about?"
                  disabled={evalBusy}
                  data-testid="decision-evaluate-input"
                />
              </div>
              <div className="admin-dialog-field">
                <label htmlFor="dlog-eval-conf">Confidence 0-1</label>
                <Input
                  id="dlog-eval-conf"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  mono
                  value={evalConfidence}
                  onChange={(e) => setEvalConfidence(e.target.value)}
                  disabled={evalBusy}
                />
              </div>
              <div className="admin-dialog-field">
                <label htmlFor="dlog-eval-rev">Reversible</label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--s-1)',
                    color: 'var(--t-2)',
                    fontSize: 13,
                  }}
                >
                  <input
                    id="dlog-eval-rev"
                    type="checkbox"
                    checked={evalReversible}
                    onChange={(e) => setEvalReversible(e.target.checked)}
                    disabled={evalBusy}
                  />
                  {evalReversible ? 'reversible' : 'irreversible'}
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleEvaluate()}
                disabled={
                  evalBusy ||
                  !evalSource.trim() ||
                  !evalDescription.trim() ||
                  !Number.isFinite(Number(evalConfidence))
                }
              >
                {evalBusy ? 'Evaluating…' : 'Evaluate'}
              </Button>
            </div>
            {evalResult ? (
              <div className="decision-evaluate-result">{evalResult}</div>
            ) : null}
          </div>

          {/* Decisions list */}
          <h3 className="admin-section-title">Recent decisions</h3>
          {decisions.length === 0 ? (
            <EmptyState
              label="No decisions logged"
              description="The decision gate logs entries as BLADE acts."
            />
          ) : (
            <div className="decision-list">
              {decisions.map((d) => {
                const type = extractSignalType(d.signal);
                const outcome = extractOutcome(d.outcome);
                const confExtracted = extractConfidence(d.signal);
                const confLabel =
                  confExtracted != null
                    ? `${Math.round(confExtracted * 100)}%`
                    : '—';
                return (
                  <div key={d.id} className="decision-row" data-testid="decision-row">
                    <span className="decision-row-ts">{formatTs(d.timestamp)}</span>
                    <span className="decision-row-signal" title={stringifyOpaque(d.signal)}>
                      <strong>{type}</strong> · {stringifyOpaque(d.signal).slice(0, 80)}
                    </span>
                    <span className="decision-row-conf">{confLabel}</span>
                    <span className="decision-row-outcome" data-outcome={outcome}>
                      {outcome}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFeedbackRow(d);
                        setFeedbackCorrect(null);
                      }}
                      data-testid="decision-feedback-button"
                    >
                      {d.feedback != null ? `Feedback: ${d.feedback ? '✓' : '✗'}` : 'Feedback'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : activeTab === 'authority' ? (
        <>
          <h3 className="admin-section-title">Authority delegations</h3>
          {delegations.length === 0 ? (
            <div className="admin-empty">No delegations yet.</div>
          ) : (
            <div>
              {delegations.map((d) => (
                <div key={d.id} className="authority-row">
                  <div className="authority-row-title">{d.task}</div>
                  <div className="authority-row-meta">
                    {d.delegated_to} ← {d.delegated_by} · <Pill>{d.status}</Pill>
                  </div>
                  {d.result ? <div className="authority-row-body">{d.result}</div> : null}
                  {d.denied_reason ? (
                    <div className="authority-row-body" style={{ color: 'var(--status-error)' }}>
                      denied: {d.denied_reason}
                    </div>
                  ) : null}
                  <div className="authority-row-meta">{formatTs(d.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          <h3 className="admin-section-title">Authority audit log</h3>
          {authorityAudit.length === 0 ? (
            <div className="admin-empty">No authority audit entries.</div>
          ) : (
            <div>
              {authorityAudit.map((entry, idx) => (
                <div key={idx} className="authority-row" data-testid="authority-audit-row">
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--t-2)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className="admin-section-title">Global audit trail</h3>
          {auditEntries.length === 0 ? (
            <div className="admin-empty">No audit entries.</div>
          ) : (
            <div>
              {auditEntries.map((e, idx) => (
                <div key={`${e.timestamp}-${idx}`} className="audit-row" data-testid="audit-row">
                  <div className="audit-row-title">{e.system} · {e.decision}</div>
                  <div className="audit-row-meta">{formatTs(e.timestamp)}</div>
                  {e.reasoning ? (
                    <div className="audit-row-body">{e.reasoning}</div>
                  ) : null}
                  {e.outcome ? (
                    <div className="audit-row-meta">outcome: {e.outcome}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Feedback dialog ─────────────────────────────────────── */}
      <Dialog
        open={feedbackRow !== null}
        onClose={() => {
          if (!feedbackBusy) {
            setFeedbackRow(null);
            setFeedbackCorrect(null);
          }
        }}
        ariaLabel="Decision feedback"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirmFeedback();
          }}
        >
          <h3 className="admin-dialog-heading">Decision feedback</h3>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: 0 }}>
            Was the decision (<strong>{extractOutcome(feedbackRow?.outcome)}</strong>) correct?
          </p>
          <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--t-2)' }}>
              <input
                type="radio"
                name="dlog-feedback"
                checked={feedbackCorrect === true}
                onChange={() => setFeedbackCorrect(true)}
                disabled={feedbackBusy}
              />
              Correct
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--t-2)' }}>
              <input
                type="radio"
                name="dlog-feedback"
                checked={feedbackCorrect === false}
                onChange={() => setFeedbackCorrect(false)}
                disabled={feedbackBusy}
              />
              Incorrect
            </label>
          </div>
          <p style={{ color: 'var(--t-4)', fontSize: 11, margin: 0 }}>
            Note: the Rust decision_feedback signature does not currently accept a free-form note.
            Per Plan 07-05 Rule 1 auto-fix: UI omitted the note field to match reality.
          </p>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFeedbackRow(null);
                setFeedbackCorrect(null);
              }}
              disabled={feedbackBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={feedbackBusy || feedbackCorrect === null}
            >
              {feedbackBusy ? 'Saving…' : 'Submit'}
            </Button>
          </div>
        </form>
      </Dialog>
    </GlassPanel>
  );
}
