// src/features/life-os/PredictionsView.tsx — Phase 6 Plan 06-04 (LIFE-07).
//
// Pending predictions (accept / dismiss), patterns, contextual prediction form,
// and the `learning_get_predictions` longer-term list. All IPC flows through
// Plan 06-02 life_os.ts wrappers — no raw invoke.
//
// Wrapper signature alignment (discovered in 06-02-SUMMARY):
//   - `predictionContextual(currentContext: string)` — takes a single context
//     string (NOT `{current_context: {app, time}}` from the draft).
//   - `predictionDismiss({id, helpful})` — requires a `helpful` boolean; we
//     pass `false` for explicit dismiss (user didn't act on it).
//   - `predictionGenerateNow()` — takes no args (AppHandle Tauri-managed).
//   - `learningGetPredictions(context)` — requires a context string.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-150
// @see .planning/phases/06-life-os-identity/06-04-PLAN.md Task 1
// @see .planning/REQUIREMENTS.md §LIFE-07

import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  learningGetPredictions,
  predictionAccept,
  predictionContextual,
  predictionDismiss,
  predictionGenerateNow,
  predictionGetPatterns,
  predictionGetPending,
} from '@/lib/tauri/life_os';
import type {
  BehaviorPattern,
  Prediction,
  UserPrediction,
} from './types';
import './life-os.css';
import './life-os-rich-b.css';

type CardStatus = 'pending' | 'accepted' | 'dismissed';

function formatConfidence(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  return `${Math.round(clamped * 100)}%`;
}

function confidencePct(v: number): number {
  return Math.max(0, Math.min(1, v)) * 100;
}

export function PredictionsView() {
  const { show } = useToast();

  const [pending, setPending] = useState<Prediction[]>([]);
  const [patterns, setPatterns] = useState<BehaviorPattern[]>([]);
  const [longTerm, setLongTerm] = useState<UserPrediction[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Per-card transient status: prediction id → 'accepted' | 'dismissed'
  const [cardStatus, setCardStatus] = useState<Record<string, CardStatus>>({});

  // Contextual prediction form state.
  const [contextInput, setContextInput] = useState('');
  const [contextResult, setContextResult] = useState<Prediction[] | null>(null);
  const [contextBusy, setContextBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pen, pat, lt] = await Promise.all([
        predictionGetPending(),
        predictionGetPatterns(),
        // Pass a sensible default context; see wrapper JSDoc.
        learningGetPredictions('home').catch(() => [] as UserPrediction[]),
      ]);
      setPending(pen);
      setPatterns(pat);
      setLongTerm(lt);
      setCardStatus({});
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const fresh = await predictionGenerateNow();
      setPending(fresh);
      setCardStatus({});
      show({ type: 'success', title: 'Predictions generated', message: `${fresh.length} pending` });
    } catch (e) {
      show({ type: 'error', title: 'Generate failed', message: String(e) });
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = async (id: string) => {
    setCardStatus((s) => ({ ...s, [id]: 'accepted' }));
    try {
      await predictionAccept(id);
      show({ type: 'success', title: 'Accepted' });
    } catch (e) {
      // Revert on failure.
      setCardStatus((s) => {
        const { [id]: _, ...rest } = s;
        return rest;
      });
      show({ type: 'error', title: 'Accept failed', message: String(e) });
    }
  };

  const handleDismiss = async (id: string) => {
    setCardStatus((s) => ({ ...s, [id]: 'dismissed' }));
    try {
      // helpful: false — explicit dismiss means "didn't act / not useful"
      await predictionDismiss({ id, helpful: false });
      show({ type: 'info', title: 'Dismissed' });
    } catch (e) {
      setCardStatus((s) => {
        const { [id]: _, ...rest } = s;
        return rest;
      });
      show({ type: 'error', title: 'Dismiss failed', message: String(e) });
    }
  };

  const handleContextual = async () => {
    const ctx = contextInput.trim();
    if (!ctx) return;
    setContextBusy(true);
    try {
      const result = await predictionContextual(ctx);
      setContextResult(result);
    } catch (e) {
      show({ type: 'error', title: 'Contextual prediction failed', message: String(e) });
      setContextResult(null);
    } finally {
      setContextBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="predictions-view-root">
      <div className="predictions-header">
        <h2>Predictions</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Generate now'}
        </Button>
      </div>

      <div className="predictions-layout">
        {/* ─────────── Pending predictions ──────────── */}
        <section>
          <p className="social-section-label">Pending predictions</p>
          {loading && <GlassSpinner />}
          {loadError && !loading && (
            <p className="life-placeholder-hint">Error: {loadError}</p>
          )}
          {!loading && !loadError && pending.length === 0 && (
            <EmptyState
              label="BLADE is still learning your patterns"
              description="Predictions will appear after 24h of observed activity — give me a day."
            />
          )}
          {!loading && pending.length > 0 && (
            <div className="predictions-list">
              {pending.map((p) => {
                const status = cardStatus[p.id] ?? 'pending';
                return (
                  <div
                    key={p.id}
                    className="prediction-card"
                    data-testid="prediction-card"
                    data-status={status}
                  >
                    <h3 className="prediction-title">{p.title}</h3>
                    <p className="prediction-desc">{p.description}</p>
                    {p.action && (
                      <p className="prediction-desc" style={{ fontStyle: 'italic' }}>
                        Suggested action: {p.action}
                      </p>
                    )}
                    <div className="prediction-confidence-bar">
                      <div
                        className="prediction-confidence-fill"
                        style={{ width: `${confidencePct(p.confidence)}%` }}
                      />
                    </div>
                    <div className="prediction-meta">
                      <span>{formatConfidence(p.confidence)} confidence</span>
                      <span>· {p.time_window}</span>
                      <span>· {p.prediction_type}</span>
                    </div>
                    {status === 'pending' && (
                      <div className="prediction-actions">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleAccept(p.id)}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDismiss(p.id)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                    {status !== 'pending' && (
                      <p className="prediction-meta" style={{ color: 'var(--t-3)' }}>
                        {status === 'accepted' ? 'Accepted ✓' : 'Dismissed'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ─────────── Contextual prediction panel ──────────── */}
        <section>
          <p className="social-section-label">Contextual prediction</p>
          <div className="predictions-contextual-form">
            <div className="predictions-contextual-row">
              <Input
                placeholder="Describe current context (e.g. 'morning, home, checking mail')"
                value={contextInput}
                onChange={(e) => setContextInput(e.target.value)}
                aria-label="Current context"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleContextual}
                disabled={contextBusy || !contextInput.trim()}
              >
                {contextBusy ? 'Predicting…' : 'Predict'}
              </Button>
            </div>
            {contextResult !== null && (
              <>
                {contextResult.length === 0 && (
                  <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
                    No contextual predictions returned for that input.
                  </p>
                )}
                {contextResult.map((p) => (
                  <div key={p.id} className="prediction-card" data-testid="prediction-card" data-status="pending">
                    <h3 className="prediction-title">{p.title}</h3>
                    <p className="prediction-desc">{p.description}</p>
                    <div className="prediction-meta">
                      <span>{formatConfidence(p.confidence)} confidence</span>
                      <span>· {p.time_window}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* ─────────── Patterns ──────────── */}
        <section>
          <p className="social-section-label">Learned patterns ({patterns.length})</p>
          {patterns.length === 0 ? (
            <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
              No behavior patterns detected yet.
            </p>
          ) : (
            <div className="predictions-patterns-list">
              {patterns.map((pat, idx) => (
                <div key={idx} className="predictions-pattern-row">
                  <div>
                    <div style={{ color: 'var(--t-1)', fontSize: 13, fontWeight: 500 }}>
                      {pat.pattern_type}
                    </div>
                    <div style={{ color: 'var(--t-2)', fontSize: 12 }}>
                      {pat.description}
                    </div>
                    <div style={{ color: 'var(--t-3)', fontSize: 11, marginTop: 2 }}>
                      Trigger: {pat.trigger} · Expected: {pat.expected_action}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--t-3)' }}>
                    <div>{formatConfidence(pat.confidence)}</div>
                    <div>{pat.occurrences} seen</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─────────── Longer-term predictions (learning engine) ──────────── */}
        <section>
          <p className="social-section-label">Longer-term predictions</p>
          {longTerm.length === 0 ? (
            <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
              No longer-term predictions available yet.
            </p>
          ) : (
            <div className="predictions-patterns-list">
              {longTerm.map((lt) => (
                <div key={lt.id} className="predictions-pattern-row">
                  <div>
                    <div style={{ color: 'var(--t-1)', fontSize: 13 }}>
                      {lt.prediction}
                    </div>
                    <div style={{ color: 'var(--t-3)', fontSize: 11, marginTop: 2 }}>
                      Context: {lt.context}
                      {lt.fulfilled && ' · fulfilled ✓'}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
                    {formatConfidence(lt.confidence)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </GlassPanel>
  );
}
