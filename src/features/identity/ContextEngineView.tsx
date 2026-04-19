// src/features/identity/ContextEngineView.tsx — Phase 6 Plan 06-06 (IDEN-06).
//
// Dev-adjacent surface for the context engine (D-158 Claude's Discretion —
// prefer developer ergonomics over polish; <pre>/monospace everywhere).
//
// Three interactions:
//   1. Assemble — context_assemble({query}) → result card with assembled text,
//      token count, per-chunk score bars.
//   2. Score chunk — context_score_chunk({query, chunk}) → numeric score +
//      range-tinted badge.
//   3. Clear cache — context_clear_cache(), gated behind Dialog confirm
//      (destructive per threat T-06-06-05).
//
// Contract:
//   - No raw invoke (D-13).
//   - Every invoke via @/lib/tauri/identity.
//   - No ChatProvider re-hoist (D-134).
//   - data-testid surface for Plan 06-07 specs:
//       context-engine-root, context-assemble-output.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-158
// @see .planning/phases/06-life-os-identity/06-06-PLAN.md Task 1
// @see .planning/REQUIREMENTS.md §IDEN-06

import { useCallback, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  contextAssemble,
  contextClearCache,
  contextScoreChunk,
} from '@/lib/tauri/identity';
import type { AssembledContextResponse } from './types';
import './identity.css';
import './identity-rich-b.css';

function scoreRange(score: number): 'low' | 'mid' | 'high' {
  if (!Number.isFinite(score)) return 'low';
  if (score >= 0.66) return 'high';
  if (score >= 0.33) return 'mid';
  return 'low';
}

function truncateChunk(text: string, max = 180): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function ContextEngineView() {
  const { show } = useToast();

  // Assemble state.
  const [query, setQuery] = useState<string>('');
  const [assembleBusy, setAssembleBusy] = useState<boolean>(false);
  const [assembled, setAssembled] = useState<AssembledContextResponse | null>(null);

  // Score state.
  const [scoreQuery, setScoreQuery] = useState<string>('');
  const [chunk, setChunk] = useState<string>('');
  const [scoreBusy, setScoreBusy] = useState<boolean>(false);
  const [score, setScore] = useState<number | null>(null);

  // Clear cache confirm state.
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [clearBusy, setClearBusy] = useState<boolean>(false);

  const runAssemble = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      show({ type: 'warn', title: 'Query is empty', message: 'Enter a query to assemble context.' });
      return;
    }
    setAssembleBusy(true);
    try {
      const result = await contextAssemble({ query: q });
      setAssembled(result);
    } catch (e) {
      show({ type: 'error', title: 'Assemble failed', message: String(e) });
    } finally {
      setAssembleBusy(false);
    }
  }, [query, show]);

  const runScore = useCallback(async () => {
    const q = scoreQuery.trim();
    const c = chunk.trim();
    if (!q || !c) {
      show({
        type: 'warn',
        title: 'Need query + chunk',
        message: 'Fill in both the query and the chunk text to score.',
      });
      return;
    }
    setScoreBusy(true);
    try {
      const result = await contextScoreChunk({ query: q, chunk: c });
      setScore(typeof result === 'number' ? result : Number(result));
    } catch (e) {
      show({ type: 'error', title: 'Score failed', message: String(e) });
    } finally {
      setScoreBusy(false);
    }
  }, [scoreQuery, chunk, show]);

  const runClear = useCallback(async () => {
    setClearBusy(true);
    try {
      await contextClearCache();
      show({ type: 'success', title: 'Context cache cleared' });
      setAssembled(null);
      setConfirmClear(false);
    } catch (e) {
      show({ type: 'error', title: 'Clear failed', message: String(e) });
    } finally {
      setClearBusy(false);
    }
  }, [show]);

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="context-engine-root">
      <header>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px 0' }}>
          Context Engine
        </h2>
        <p style={{ color: 'var(--t-3)', fontSize: 13, margin: '0 0 var(--s-3) 0' }}>
          Developer surface for the context assembler. Assemble a context bundle, score a chunk
          against a query, or clear the assembled-context cache.
        </p>
      </header>

      {/* ── Assemble ───────────────────────────────────────────────── */}
      <section className="context-card" aria-label="Assemble context">
        <p className="reasoning-section-label">Assemble</p>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Query — e.g. “what did I decide about the billing refactor last week?”"
          aria-label="Assembly query"
          disabled={assembleBusy}
        />
        <div className="context-card-actions">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void runAssemble()}
            disabled={assembleBusy || query.trim().length === 0}
          >
            {assembleBusy ? 'Assembling…' : 'Assemble'}
          </Button>
          {assembleBusy ? <GlassSpinner size={14} label="Assembling context" /> : null}
        </div>
      </section>

      {assembled ? (
        <section className="context-card" data-testid="context-assemble-output">
          <p className="reasoning-section-label">Result</p>
          <div className="context-result-meta">
            <Pill tone="default">{assembled.total_tokens ?? 0} tokens</Pill>
            <Pill tone="default">{(assembled.chunks ?? []).length} chunks</Pill>
            {assembled.was_truncated ? <Pill tone="new">truncated</Pill> : null}
            {Array.isArray(assembled.sources_used) && assembled.sources_used.length > 0 ? (
              <span>sources: {assembled.sources_used.join(', ')}</span>
            ) : null}
          </div>
          <pre className="context-assembled-text" aria-label="Assembled context text">
            {typeof assembled.formatted === 'string' && assembled.formatted.length > 0
              ? assembled.formatted
              : '(empty assembly)'}
          </pre>
          {Array.isArray(assembled.chunks) && assembled.chunks.length > 0 ? (
            <div className="context-chunks-list">
              {assembled.chunks.map((c, i) => {
                const range = scoreRange(Number(c.relevance_score ?? 0));
                return (
                  <div key={`${c.source ?? 'chunk'}-${i}`} className="context-chunk-row">
                    <span className="context-chunk-score" data-score-range={range}>
                      {Number(c.relevance_score ?? 0).toFixed(3)}
                    </span>
                    <div>
                      <div className="context-chunk-body">{truncateChunk(String(c.content ?? ''))}</div>
                      <div className="context-chunk-source">
                        {(c.source ?? 'unknown source') as string} · {Number(c.token_estimate ?? 0)} tok
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Score a chunk ──────────────────────────────────────────── */}
      <section className="context-card" aria-label="Score a chunk against a query">
        <p className="reasoning-section-label">Score a chunk</p>
        <textarea
          value={scoreQuery}
          onChange={(e) => setScoreQuery(e.target.value)}
          placeholder="Query — the thing you're asking about"
          aria-label="Score query"
          disabled={scoreBusy}
          style={{ minHeight: 64 }}
        />
        <textarea
          value={chunk}
          onChange={(e) => setChunk(e.target.value)}
          placeholder="Chunk — the candidate text to score for relevance"
          aria-label="Chunk text"
          disabled={scoreBusy}
          style={{ marginTop: 'var(--s-2)' }}
        />
        <div className="context-card-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runScore()}
            disabled={scoreBusy || scoreQuery.trim().length === 0 || chunk.trim().length === 0}
          >
            {scoreBusy ? 'Scoring…' : 'Score'}
          </Button>
          {scoreBusy ? <GlassSpinner size={14} label="Scoring chunk" /> : null}
        </div>
        {score !== null ? (
          <div
            className="context-score-readout"
            data-score-range={scoreRange(score)}
            aria-live="polite"
          >
            Relevance score: {score.toFixed(4)}
          </div>
        ) : null}
      </section>

      {/* ── Clear cache (destructive) ──────────────────────────────── */}
      <section className="context-card" aria-label="Clear context cache">
        <p className="reasoning-section-label">Clear cache</p>
        <p style={{ color: 'var(--t-3)', fontSize: 12, margin: '0 0 var(--s-2) 0' }}>
          Drops every cached assembled context. The cache is rebuildable but in-flight requests may
          see a latency spike while it repopulates.
        </p>
        <div className="context-card-actions">
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={clearBusy}>
            Clear context cache…
          </Button>
        </div>
      </section>

      <Dialog
        open={confirmClear}
        onClose={() => (clearBusy ? undefined : setConfirmClear(false))}
        ariaLabel="Confirm clear context cache"
      >
        <div className="kali-dialog-body">
          <h3>Clear context cache?</h3>
          <p>
            Every cached assembled-context bundle will be dropped. Re-assembly will rebuild them on
            demand — expect a one-off latency spike on the next queries.
          </p>
          <div className="kali-dialog-actions">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)} disabled={clearBusy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void runClear()} disabled={clearBusy}>
              {clearBusy ? 'Clearing…' : 'Clear cache'}
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
