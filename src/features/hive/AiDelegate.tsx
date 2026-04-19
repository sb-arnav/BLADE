// src/features/hive/AiDelegate.tsx — HIVE-06.
//
// Delegate review surface: aiDelegateCheck hero + Introduce button +
// local ring buffer of AI_DELEGATE_APPROVED/DENIED events with per-entry
// feedback Dialog (client-side prefs write — backend delegate_feedback
// absent per D-205).
//
// @see .planning/phases/08-body-hive/08-04-PLAN.md (Task 2)
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-205
// @see .planning/REQUIREMENTS.md §HIVE-06

import { useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import { aiDelegateCheck, aiDelegateIntroduce } from '@/lib/tauri/hive';
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

  const saveFeedback = () => {
    if (feedbackFor === null) return;
    const entry = log[feedbackFor];
    if (!entry) return;
    const key = `hive.aiDelegate.feedback.${entry.at}`;
    setPref(
      key,
      JSON.stringify({
        kind: entry.kind,
        was_correct: feedbackCorrect,
        note: feedbackNote,
        tool_name: summarizePayload(entry.payload).toolName,
      }),
    );
    toast.show({
      type: 'info',
      title: 'Feedback saved locally',
      message: 'Backend delegate_feedback not yet wired (Phase 9)',
    });
    setFeedbackFor(null);
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
          <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-3)' }}>
            No delegate decisions yet. Trigger a tool-use approval in Chat to
            populate this log.
          </p>
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
        onClose={() => setFeedbackFor(null)}
        ariaLabel="Delegate feedback"
      >
        <h3 style={{ margin: 0 }}>Delegate feedback</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--space-2)' }}>
          Saved locally to prefs only — backend <code>delegate_feedback</code>{' '}
          is not yet wired (Phase 9 polish).
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
          <Button variant="ghost" onClick={() => setFeedbackFor(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveFeedback}>Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
