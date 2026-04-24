// src/features/hive/AiDelegate.tsx — HIVE-06.
//
// Delegate review surface: aiDelegateCheck hero + Introduce button +
// local ring buffer of AI_DELEGATE_APPROVED/DENIED events with per-entry
// feedback Dialog that persists via backend delegate_feedback (Plan 09-01
// closed D-205 gap). Prefs ring buffer remains as short-term session echo.
//
// @see .planning/phases/09-polish/09-01-PLAN.md (delegate_feedback backfill)
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 2)
// @see .planning/REQUIREMENTS.md §HIVE-06

import { useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Pill, EmptyState } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import { aiDelegateCheck, aiDelegateIntroduce, delegateFeedback } from '@/lib/tauri/hive';
import type { AiDelegateInfo } from '@/lib/tauri/hive';
import './hive.css';

const MAX_LOG = 50;

interface LogEntry {
  kind: 'approved' | 'denied';
  payload: Record<string, unknown>;
  at: number;
}

function summarizePayload(p: Record<string, unknown>): {
  toolName: string;
  verdict: string;
  reasoning: string;
} {
  const toolName = typeof p.tool_name === 'string' ? p.tool_name : 'unknown tool';
  const verdict = typeof p.verdict === 'string'
    ? p.verdict
    : typeof p.decision === 'string'
    ? p.decision
    : '';
  const reasoning = typeof p.reasoning === 'string'
    ? p.reasoning.slice(0, 80)
    : typeof p.reason === 'string'
    ? p.reason.slice(0, 80)
    : '';
  return { toolName, verdict, reasoning };
}

function formatTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString();
}

export function AiDelegate() {
  const { setPref } = usePrefs();
  const toast = useToast();
  const [info, setInfo] = useState<AiDelegateInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [introducing, setIntroducing] = useState(false);
  const [introResponse, setIntroResponse] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);
  const [feedbackCorrect, setFeedbackCorrect] = useState(true);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  useEffect(() => {
    aiDelegateCheck().then(setInfo).catch((e) => setLoadError(String(e)));
  }, []);

  useTauriEvent<Record<string, unknown>>(BLADE_EVENTS.AI_DELEGATE_APPROVED, (e) => {
    setLog((prev) =>
      [
        { kind: 'approved' as const, payload: e.payload ?? {}, at: Date.now() },
        ...prev,
      ].slice(0, MAX_LOG),
    );
  });

  useTauriEvent<Record<string, unknown>>(BLADE_EVENTS.AI_DELEGATE_DENIED, (e) => {
    setLog((prev) =>
      [
        { kind: 'denied' as const, payload: e.payload ?? {}, at: Date.now() },
        ...prev,
      ].slice(0, MAX_LOG),
    );
  });

  const onIntroduce = async () => {
    setIntroducing(true);
    setIntroResponse(null);
    try {
      const resp = await aiDelegateIntroduce();
      setIntroResponse(resp);
      toast.show({
        type: 'success',
        title: 'Delegate responded',
        message: resp.slice(0, 120),
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Introduce failed',
        message: String(err),
      });
    } finally {
      setIntroducing(false);
    }
  };

  const openFeedback = (index: number) => {
    setFeedbackFor(index);
    setFeedbackCorrect(true);
    setFeedbackNote('');
  };

  const saveFeedback = async () => {
    if (feedbackFor === null) return;
    const entry = log[feedbackFor];
    if (!entry) return;
    const summary = summarizePayload(entry.payload);
    // decision_id fallback chain: explicit payload id → tool+timestamp composite.
    const decisionId =
      (typeof entry.payload.decision_id === 'string' && entry.payload.decision_id) ||
      (typeof entry.payload.id === 'string' && entry.payload.id) ||
      `${summary.toolName}-${entry.at}`;
    setFeedbackBusy(true);
    try {
      await delegateFeedback({
        decisionId,
        wasCorrect: feedbackCorrect,
        note: feedbackNote.trim() ? feedbackNote.trim() : undefined,
      });
      // Keep the prefs ring buffer as a short-term session echo of feedback
      // history (backend persists long-term).
      const key = `hive.aiDelegate.feedback.${entry.at}`;
      setPref(
        key,
        JSON.stringify({
          kind: entry.kind,
          was_correct: feedbackCorrect,
          note: feedbackNote,
          tool_name: summary.toolName,
        }),
      );
      toast.show({ type: 'success', title: 'Feedback recorded' });
      setFeedbackFor(null);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Save failed',
        message: String(err),
      });
      // Leave dialog open so the operator can retry.
    } finally {
      setFeedbackBusy(false);
    }
  };

  if (loadError) {
    return (
      <GlassPanel className="ai-delegate" data-testid="ai-delegate-root">
        <h2 style={{ margin: 0 }}>AI Delegate</h2>
        <p style={{ color: 'var(--status-error)' }}>Failed to load: {loadError}</p>
      </GlassPanel>
    );
  }

  return (
    <div className="ai-delegate" data-testid="ai-delegate-root">
      <GlassPanel className="ai-delegate-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>AI Delegate</h2>
          {info ? (
            <>
              <Pill tone={info.available ? 'free' : 'default'} dot>
                {info.name}
              </Pill>
              <Pill tone={info.available ? 'free' : 'new'}>
                {info.available ? 'available' : 'unavailable'}
              </Pill>
            </>
          ) : (
            <GlassSpinner />
          )}
        </div>
        {info?.reasoning && (
          <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {info.reasoning}
          </p>
        )}
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Button
            onClick={onIntroduce}
            disabled={introducing || !info?.available}
            data-testid="introduce-button"
          >
            {introducing ? 'Introducing…' : 'Introduce BLADE to delegate'}
          </Button>
          {introducing && <GlassSpinner />}
        </div>
        {introResponse && (
          <pre className="decision-details" style={{ marginTop: 'var(--space-3)' }}>
            {introResponse}
          </pre>
        )}
      </GlassPanel>

      <GlassPanel style={{ padding: 'var(--space-3)' }}>
        <h3 style={{ margin: 0 }}>Recent delegate decisions ({log.length})</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 12, marginTop: 'var(--space-1)' }}>
          Live ring buffer (max {MAX_LOG}) of AI_DELEGATE_APPROVED / DENIED events.
        </p>
        {log.length === 0 ? (
          <EmptyState
            label="BLADE is still learning your delegation preferences"
            description="Decisions will appear once BLADE starts reviewing — introduce BLADE to the delegate to begin."
            actionLabel={introducing ? 'Introducing…' : 'Introduce BLADE'}
            onAction={onIntroduce}
          />
        ) : (
          <div className="delegate-log" style={{ marginTop: 'var(--space-2)' }}>
            {log.map((entry, i) => {
              const s = summarizePayload(entry.payload);
              return (
                <div
                  key={`${entry.at}-${i}`}
                  className={`delegate-log-row kind-${entry.kind}`}
                  data-testid={`delegate-log-${i}`}
                >
                  <Pill tone={entry.kind === 'approved' ? 'free' : 'new'}>
                    {entry.kind}
                  </Pill>
                  <div>
                    <div className="delegate-log-summary">
                      <strong>{s.toolName}</strong>
                      {s.verdict && ` · ${s.verdict}`}
                    </div>
                    <div className="delegate-log-meta">
                      {formatTime(entry.at)}
                      {s.reasoning && ` · ${s.reasoning}`}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => openFeedback(i)}>
                    Feedback
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </GlassPanel>

      <Dialog
        open={feedbackFor !== null}
        onClose={() => !feedbackBusy && setFeedbackFor(null)}
        ariaLabel="Delegate feedback"
      >
        <h3 style={{ margin: 0 }}>Delegate feedback</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Feedback is persisted via <code>delegate_feedback</code> to the
          delegate audit log; a local echo stays in prefs for the session.
        </p>
        <div className="feedback-form">
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={feedbackCorrect}
              onChange={(e) => setFeedbackCorrect(e.target.checked)}
            />
            Delegate decision was correct
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 12, color: 'var(--t-2)' }}>
            Note (optional)
            <textarea
              className="input"
              rows={4}
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              placeholder="Why was this right / wrong?"
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" onClick={() => setFeedbackFor(null)} disabled={feedbackBusy}>Cancel</Button>
          <Button variant="primary" onClick={saveFeedback} disabled={feedbackBusy}>
            {feedbackBusy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
