// src/features/life-os/EmotionalIntelView.tsx — Phase 6 Plan 06-04 (LIFE-08).
//
// Current emotion (hormone-tinted card), text-first emoji trend sparkline,
// readings list (T-06-04-04: limit=50), analyze-patterns Dialog, context panel.
// Per D-162 this view does NOT subscribe to hormone/godmode events; refetch
// on route focus is sufficient.
//
// Wrapper signature alignment (discovered in 06-02-SUMMARY):
//   - `emotionGetTrend()` takes NO args (the draft's `{window_hours: 24}` was
//     wrong); Rust returns a compact EmotionalTrend struct with avg_valence
//     + dominant_emotion + notable_shifts.
//   - `emotionGetReadings(limit?)` takes limit directly as a number, not
//     `{limit: 50}` object.
//   - `emotionAnalyzePatterns(daysBack?)` takes an optional days_back number.
//
// EMOTION_STATUS_MAP below is the ground truth for Plan 06-07 spec —
// maps primary_emotion strings → sentiment classification (positive/neutral/
// negative/unknown) which in turn drives the `data-sentiment` CSS border tint.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-151, §D-162
// @see .planning/phases/06-life-os-identity/06-04-PLAN.md Task 2
// @see .planning/REQUIREMENTS.md §LIFE-08

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  emotionAnalyzePatterns,
  emotionGetContext,
  emotionGetCurrent,
  emotionGetReadings,
  emotionGetTrend,
} from '@/lib/tauri/life_os';
import type { EmotionalState, EmotionalTrend } from './types';
import './life-os.css';
import './life-os-rich-b.css';

type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

/**
 * EMOTION_STATUS_MAP — canonical mapping from Rust `primary_emotion` string
 * to Sentiment bucket. Plan 06-07's Playwright spec asserts against this
 * exact mapping.
 */
export const EMOTION_STATUS_MAP: Record<string, Sentiment> = {
  // Positive
  calm: 'positive',
  focused: 'positive',
  happy: 'positive',
  joyful: 'positive',
  content: 'positive',
  excited: 'positive',
  relaxed: 'positive',
  energized: 'positive',
  // Neutral
  neutral: 'neutral',
  curious: 'neutral',
  contemplative: 'neutral',
  alert: 'neutral',
  // Negative
  stressed: 'negative',
  anxious: 'negative',
  frustrated: 'negative',
  sad: 'negative',
  angry: 'negative',
  tired: 'negative',
  overwhelmed: 'negative',
};

function classifyEmotion(primary?: string): Sentiment {
  if (!primary) return 'unknown';
  const key = primary.toLowerCase();
  return EMOTION_STATUS_MAP[key] ?? 'neutral';
}

/** Valence-based intensity emoji for the text-first sparkline (D-02). */
function intensityEmoji(valence: number, arousal: number): string {
  // Combine valence (−1..+1) with arousal (0..+1) to pick a band.
  // High arousal + negative valence → red; high valence → green; else → yellow.
  const intensity = Math.abs(valence) * 0.6 + arousal * 0.4;
  if (valence < -0.2 && intensity > 0.5) return '🔴';
  if (valence > 0.2 && intensity > 0.4) return '🟢';
  if (intensity > 0.3) return '🟡';
  return '⚪';
}

function formatTime(ts?: number | null): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EmotionalIntelView() {
  const { show } = useToast();

  const [current, setCurrent] = useState<EmotionalState | null>(null);
  const [trend, setTrend] = useState<EmotionalTrend | null>(null);
  const [readings, setReadings] = useState<EmotionalState[]>([]);
  const [context, setContext] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [c, t, r, ctx] = await Promise.all([
        emotionGetCurrent(),
        emotionGetTrend(),
        emotionGetReadings(50),
        emotionGetContext(),
      ]);
      setCurrent(c);
      setTrend(t);
      setReadings(r);
      setContext(ctx);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAnalyze = async () => {
    setAnalyzeBusy(true);
    setAnalyzeResult(null);
    setAnalyzeOpen(true);
    try {
      const result = await emotionAnalyzePatterns(14);
      setAnalyzeResult(result);
    } catch (e) {
      show({ type: 'error', title: 'Analyze failed', message: String(e) });
      setAnalyzeResult(null);
    } finally {
      setAnalyzeBusy(false);
    }
  };

  const sentiment: Sentiment = classifyEmotion(current?.primary_emotion);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="emotional-intel-root">
      <div className="emotional-intel-header">
        <h2>Emotional Intelligence</h2>
        <Button variant="secondary" size="sm" onClick={handleAnalyze}>
          Analyze patterns
        </Button>
      </div>

      {loading && <GlassSpinner />}
      {loadError && !loading && (
        <p className="life-placeholder-hint">Error: {loadError}</p>
      )}

      {!loading && !loadError && (
        <div className="emotional-intel-layout">
          {/* ─────────── Current emotion card ──────────── */}
          <div
            className="emotion-current-card"
            data-testid="emotion-current-card"
            data-sentiment={sentiment}
          >
            <div>
              <div className="emotion-label">
                {current?.primary_emotion ?? 'unknown'}
              </div>
              <div style={{ color: 'var(--t-3)', fontSize: 12, marginTop: 2 }}>
                Confidence {current ? Math.round(current.confidence * 100) : 0}% ·
                sentiment: {sentiment}
              </div>
            </div>
            <div className="emotion-meta">
              <span>valence {current ? current.valence.toFixed(2) : '—'}</span>
              <span>arousal {current ? current.arousal.toFixed(2) : '—'}</span>
            </div>
          </div>

          {/* ─────────── Trend sparkline (text-first per D-02) ──────────── */}
          <section>
            <p className="social-section-label">Trend (last ~24h)</p>
            <div className="emotion-sparkline" aria-label="Emotion trend sparkline">
              {readings.length === 0 ? (
                <span className="emotion-sparkline-empty">
                  No readings yet.
                </span>
              ) : (
                readings
                  .slice(0, 24)
                  .reverse()
                  .map((r, i) => (
                    <span key={i} title={`${r.primary_emotion} (v ${r.valence.toFixed(2)})`}>
                      {intensityEmoji(r.valence, r.arousal)}
                    </span>
                  ))
              )}
            </div>
            {trend && (
              <p
                style={{
                  color: 'var(--t-3)',
                  fontSize: 12,
                  marginTop: 'var(--s-2)',
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: 'var(--t-2)' }}>
                  {trend.period}:
                </strong>{' '}
                dominant <em>{trend.dominant_emotion}</em> · avg valence{' '}
                {trend.avg_valence.toFixed(2)}
                {trend.recommendation && <> — {trend.recommendation}</>}
              </p>
            )}
          </section>

          {/* ─────────── Readings list ──────────── */}
          <section>
            <p className="social-section-label">Readings ({readings.length})</p>
            {readings.length === 0 ? (
              <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
                No readings in the recent window.
              </p>
            ) : (
              <div className="emotion-readings-list">
                {readings.map((r, idx) => {
                  // EmotionalState has no timestamp field; render index-based row.
                  const intensity = Math.round(Math.abs(r.valence) * 100);
                  const tsRaw = (r as Record<string, unknown>).timestamp;
                  const ts = typeof tsRaw === 'number' ? tsRaw : null;
                  return (
                    <div
                      key={idx}
                      className="emotion-reading-row"
                      data-testid="emotion-reading-row"
                    >
                      <span>{ts ? formatTime(ts) : `#${idx + 1}`}</span>
                      <span style={{ color: 'var(--t-1)' }}>
                        {r.primary_emotion}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {intensity}%
                      </span>
                      <span style={{ color: 'var(--t-3)' }}>
                        v {r.valence.toFixed(2)} · a {r.arousal.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ─────────── Context panel ──────────── */}
          <section>
            <p className="social-section-label">Context BLADE sees</p>
            <div className="emotion-context-panel">
              {context ? context : <em style={{ color: 'var(--t-3)' }}>No context available.</em>}
            </div>
          </section>
        </div>
      )}

      {/* ─────────── Analyze patterns Dialog ──────────── */}
      <Dialog
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        ariaLabel="Emotional pattern analysis"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Emotional patterns</h3>
        <div style={{ marginTop: 'var(--s-3)', minHeight: 120 }}>
          {analyzeBusy && <GlassSpinner />}
          {!analyzeBusy && analyzeResult && (
            <div
              style={{
                color: 'var(--t-2)',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
              }}
            >
              {analyzeResult}
            </div>
          )}
          {!analyzeBusy && !analyzeResult && (
            <p style={{ color: 'var(--t-3)', fontSize: 13 }}>No analysis returned.</p>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 'var(--s-4)',
          }}
        >
          <Button variant="ghost" onClick={() => setAnalyzeOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
