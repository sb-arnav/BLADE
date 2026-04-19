// src/features/identity/ReasoningView.tsx — Phase 6 Plan 06-06 (IDEN-05).
//
// Reasoning workshop surface (D-157). Prompt textarea + 4 tool buttons that
// invoke the reasoning_engine.rs commands and render output inline. Recent
// traces loaded on mount from reasoning_get_traces({limit: 20}) appear as a
// collapsible list below. All invokes are wrapped + error-handled via toast.
//
// Contract:
//   - No raw invoke / listen (D-13, ESLint no-raw-tauri).
//   - Every invoke flows through @/lib/tauri/identity wrappers.
//   - No ChatProvider re-hoist (D-134 inheritance).
//   - data-testid surface for Plan 06-07 specs:
//       reasoning-view-root, reasoning-tool-output, reasoning-trace-row.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-157
// @see .planning/phases/06-life-os-identity/06-06-PLAN.md Task 1
// @see .planning/REQUIREMENTS.md §IDEN-05

import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  reasoningDecompose,
  reasoningGetTraces,
  reasoningSocratic,
  reasoningTestHypothesis,
  reasoningThink,
} from '@/lib/tauri/identity';
import type { ReasoningTrace } from './types';
import './identity.css';
import './identity-rich-b.css';

/** Which reasoning tool produced the current output panel. */
type ToolKind = 'think' | 'decompose' | 'test-hypothesis' | 'socratic';

const TOOL_LABELS: Record<ToolKind, string> = {
  think: 'Think',
  decompose: 'Decompose',
  'test-hypothesis': 'Test Hypothesis',
  socratic: 'Socratic',
};

interface ToolOutput {
  kind: ToolKind;
  ranAt: number;
  durationMs: number;
  body: string;
}

/** Stable formatter for the trace-row timestamp column. */
function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hh}:${mm}`;
}

/** Short preview of a trace's question (first 120 chars, no newlines). */
function tracePreview(trace: ReasoningTrace): string {
  const q = typeof trace.question === 'string' ? trace.question : '';
  const normalized = q.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized || '(no question)';
}

/** Best-effort detail render for an expanded trace — mirror Rust shape. */
function traceDetailBody(trace: ReasoningTrace): string {
  const lines: string[] = [];
  if (typeof trace.final_answer === 'string' && trace.final_answer.length > 0) {
    lines.push('─ Final answer ─');
    lines.push(trace.final_answer);
    lines.push('');
  }
  if (Array.isArray(trace.steps) && trace.steps.length > 0) {
    lines.push(`─ Steps (${trace.steps.length}) ─`);
    trace.steps.forEach((step, i) => {
      const num = typeof step.step_num === 'number' ? step.step_num : i + 1;
      const content = typeof step.content === 'string' ? step.content : JSON.stringify(step);
      lines.push(`${num}. ${content}`);
    });
  }
  if (typeof trace.total_confidence === 'number') {
    lines.push('');
    lines.push(`confidence: ${(trace.total_confidence * 100).toFixed(1)}%`);
  }
  return lines.join('\n').trim() || '(empty trace)';
}

/** Stringify a tool return value (varies per tool) for the output panel. */
function stringifyToolResult(kind: ToolKind, result: unknown): string {
  if (kind === 'think') {
    const trace = result as ReasoningTrace;
    if (typeof trace?.final_answer === 'string' && trace.final_answer.length > 0) {
      return traceDetailBody(trace);
    }
    return JSON.stringify(result, null, 2);
  }
  if (kind === 'decompose') {
    if (Array.isArray(result)) {
      return (result as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n') || '(no sub-problems)';
    }
    return JSON.stringify(result, null, 2);
  }
  if (kind === 'test-hypothesis') {
    // HypothesisTest shape.
    const t = result as {
      hypothesis?: string;
      evidence_for?: string[];
      evidence_against?: string[];
      verdict?: string;
      confidence?: number;
    };
    const parts: string[] = [];
    if (t.hypothesis) parts.push(`Hypothesis: ${t.hypothesis}`);
    if (t.verdict) parts.push(`Verdict: ${t.verdict}`);
    if (typeof t.confidence === 'number') parts.push(`Confidence: ${(t.confidence * 100).toFixed(1)}%`);
    if (Array.isArray(t.evidence_for) && t.evidence_for.length > 0) {
      parts.push('');
      parts.push('Evidence for:');
      t.evidence_for.forEach((e) => parts.push(`  + ${e}`));
    }
    if (Array.isArray(t.evidence_against) && t.evidence_against.length > 0) {
      parts.push('');
      parts.push('Evidence against:');
      t.evidence_against.forEach((e) => parts.push(`  - ${e}`));
    }
    return parts.join('\n') || JSON.stringify(result, null, 2);
  }
  if (kind === 'socratic') {
    if (Array.isArray(result)) {
      const tuples = result as Array<[string, string]>;
      return tuples
        .map(([q, a], i) => `Q${i + 1}: ${q}\nA${i + 1}: ${a}`)
        .join('\n\n') || '(no dialogue)';
    }
    return JSON.stringify(result, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

export function ReasoningView() {
  const { show } = useToast();

  const [prompt, setPrompt] = useState<string>('');
  const [busyTool, setBusyTool] = useState<ToolKind | null>(null);
  const [output, setOutput] = useState<ToolOutput | null>(null);

  const [traces, setTraces] = useState<ReasoningTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refreshTraces = useCallback(async () => {
    setTracesLoading(true);
    try {
      const rows = await reasoningGetTraces(20);
      setTraces(Array.isArray(rows) ? rows : []);
    } catch (e) {
      show({ type: 'error', title: 'Could not load reasoning traces', message: String(e) });
      setTraces([]);
    } finally {
      setTracesLoading(false);
    }
  }, [show]);

  useEffect(() => {
    void refreshTraces();
  }, [refreshTraces]);

  const runTool = useCallback(
    async (kind: ToolKind) => {
      const text = prompt.trim();
      if (!text) {
        show({ type: 'warn', title: 'Prompt is empty', message: 'Enter a prompt before running a tool.' });
        return;
      }
      setBusyTool(kind);
      const started = performance.now();
      try {
        let result: unknown;
        if (kind === 'think') {
          result = await reasoningThink({ question: text });
        } else if (kind === 'decompose') {
          result = await reasoningDecompose(text);
        } else if (kind === 'test-hypothesis') {
          result = await reasoningTestHypothesis({ hypothesis: text, evidence: '' });
        } else {
          result = await reasoningSocratic({ question: text });
        }
        const durationMs = Math.round(performance.now() - started);
        setOutput({
          kind,
          ranAt: Date.now(),
          durationMs,
          body: stringifyToolResult(kind, result),
        });
        // Think produces a new trace server-side; refresh the list so it shows up.
        if (kind === 'think') {
          void refreshTraces();
        }
      } catch (e) {
        show({
          type: 'error',
          title: `${TOOL_LABELS[kind]} failed`,
          message: String(e),
        });
      } finally {
        setBusyTool(null);
      }
    },
    [prompt, refreshTraces, show],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const busy = busyTool !== null;

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="reasoning-view-root">
      <header>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px 0' }}>
          Reasoning
        </h2>
        <p style={{ color: 'var(--t-3)', fontSize: 13, margin: '0 0 var(--s-3) 0' }}>
          Think through a prompt with one of four structured tools. Traces are saved locally and appear below.
        </p>
      </header>

      <div className="reasoning-input-row">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt, problem, hypothesis, or question…"
          aria-label="Reasoning prompt"
          disabled={busy}
        />
        <div className="reasoning-tools">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void runTool('think')}
            disabled={busy || prompt.trim().length === 0}
          >
            {busyTool === 'think' ? 'Thinking…' : 'Think'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTool('decompose')}
            disabled={busy || prompt.trim().length === 0}
          >
            {busyTool === 'decompose' ? 'Decomposing…' : 'Decompose'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTool('test-hypothesis')}
            disabled={busy || prompt.trim().length === 0}
          >
            {busyTool === 'test-hypothesis' ? 'Testing…' : 'Test Hypothesis'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTool('socratic')}
            disabled={busy || prompt.trim().length === 0}
          >
            {busyTool === 'socratic' ? 'Questioning…' : 'Socratic'}
          </Button>
          {busy ? (
            <span className="reasoning-tools-meta" aria-live="polite">
              <GlassSpinner size={14} label="Running reasoning tool" />
            </span>
          ) : null}
        </div>
      </div>

      {output ? (
        <div data-testid="reasoning-tool-output">
          <p className="reasoning-section-label">Output</p>
          <div className="reasoning-output">
            <div className="reasoning-output-header">
              <Pill tone="default">{TOOL_LABELS[output.kind]}</Pill>
              <span>{output.durationMs} ms</span>
              <span>•</span>
              <span>{formatTs(output.ranAt)}</span>
            </div>
            <div className="reasoning-output-body">{output.body}</div>
          </div>
        </div>
      ) : null}

      <div>
        <p className="reasoning-section-label">Recent traces</p>
        {tracesLoading ? (
          <div className="reasoning-empty">
            <GlassSpinner size={18} label="Loading traces" />
          </div>
        ) : traces.length === 0 ? (
          <EmptyState
            label="No reasoning traces"
            description="BLADE logs reasoning across chat + agent work."
          />
        ) : (
          <div className="reasoning-traces-list">
            {traces.map((trace) => {
              const id = typeof trace.id === 'string' ? trace.id : `${trace.created_at}`;
              const isOpen = expanded.has(id);
              return (
                <div
                  key={id}
                  className="reasoning-trace-row"
                  data-testid="reasoning-trace-row"
                  data-trace-id={id}
                  data-expanded={isOpen}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(id);
                    }
                  }}
                  aria-expanded={isOpen}
                >
                  <span className="reasoning-trace-preview">{tracePreview(trace)}</span>
                  <span className="reasoning-trace-ts">{formatTs((trace.created_at ?? 0) * 1000)}</span>
                  {isOpen ? (
                    <div className="reasoning-trace-expanded">{traceDetailBody(trace)}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
