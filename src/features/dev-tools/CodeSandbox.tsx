// src/features/dev-tools/CodeSandbox.tsx
//
// DEV-09 — safe multi-language code execution surface.
// Wires code_sandbox::sandbox_run / sandbox_run_explain / sandbox_fix_and_run
// / sandbox_detect_language.
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 2 — DEV-09)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-180
// @see src-tauri/src/code_sandbox.rs:696,707,716,727

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  sandboxRun,
  sandboxRunExplain,
  sandboxFixAndRun,
  sandboxDetectLanguage,
} from '@/lib/tauri/dev_tools';
import type { SandboxResult } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

const LANGUAGES = ['python', 'javascript', 'typescript', 'bash', 'rust', 'go'] as const;

interface HistoryEntry {
  id: string;
  language: string;
  code: string;
  result: SandboxResult;
  explanation?: string;
  ranAt: number;
}

const HISTORY_MAX = 10;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CodeSandbox() {
  const toast = useToast();

  const [code, setCode] = useState<string>('');
  const [language, setLanguage] = useState<string>('python');
  const [autoDetect, setAutoDetect] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [explanation, setExplanation] = useState<string>('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const detectTimer = useRef<number | null>(null);

  const runDetect = useCallback(async (src: string) => {
    if (!src.trim()) return;
    try {
      const detected = await sandboxDetectLanguage(src);
      if (detected) setLanguage(detected);
    } catch {
      // detect failures are silent — user can still pick a language manually.
    }
  }, []);

  useEffect(() => {
    if (!autoDetect) return;
    if (detectTimer.current !== null) window.clearTimeout(detectTimer.current);
    detectTimer.current = window.setTimeout(() => {
      void runDetect(code);
    }, 400);
    return () => {
      if (detectTimer.current !== null) window.clearTimeout(detectTimer.current);
    };
  }, [code, autoDetect, runDetect]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev];
      return next.slice(0, HISTORY_MAX);
    });
  }, []);

  const handleRun = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setExplanation('');
    try {
      const r = await sandboxRun({ language, code });
      setResult(r);
      pushHistory({ id: makeId(), language, code, result: r, ranAt: Date.now() });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Run failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRunExplain = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    try {
      const [r, explain] = await Promise.all([
        sandboxRun({ language, code }),
        sandboxRunExplain({ language, code }),
      ]);
      setResult(r);
      setExplanation(explain);
      pushHistory({
        id: makeId(),
        language,
        code,
        result: r,
        explanation: explain,
        ranAt: Date.now(),
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Run + explain failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFixAndRun = async () => {
    if (busy || !code.trim() || !result?.stderr) return;
    setBusy(true);
    try {
      const r = await sandboxFixAndRun({
        language,
        code,
        error: result.stderr,
      });
      setResult(r);
      setExplanation('');
      pushHistory({ id: makeId(), language, code, result: r, ranAt: Date.now() });
      toast.show({
        type: 'success',
        title: 'Fix + run complete',
        message: r.success ? 'Success.' : `Exit ${r.exit_code}`,
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Fix + run failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const restoreHistory = (h: HistoryEntry) => {
    setCode(h.code);
    setLanguage(h.language);
    setResult(h.result);
    setExplanation(h.explanation ?? '');
  };

  const status: 'complete' | 'failed' | 'idle' = useMemo(() => {
    if (!result) return 'idle';
    return result.exit_code === 0 ? 'complete' : 'failed';
  }, [result]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="code-sandbox-root">
      <div className="code-sandbox-layout">
        <div className="code-sandbox-main">
          <div className="code-sandbox-lang-row">
            <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Language</label>
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                className="dev-tab-pill"
                data-active={String(language === l)}
                onClick={() => setLanguage(l)}
                data-testid={`code-sandbox-lang-${l}`}
              >
                {l}
              </button>
            ))}
            <label
              style={{
                fontSize: 12,
                color: 'var(--t-3)',
                display: 'inline-flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <input
                type="checkbox"
                checked={autoDetect}
                onChange={(e) => setAutoDetect(e.target.checked)}
                data-testid="code-sandbox-auto-detect"
              />
              Auto-detect
            </label>
          </div>

          <textarea
            className="code-sandbox-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={"# Paste code here…\n"}
            spellCheck={false}
            data-testid="code-sandbox-code"
          />

          <div className="code-sandbox-action-row">
            <Button
              variant="primary"
              onClick={handleRun}
              disabled={busy || !code.trim()}
              data-testid="code-sandbox-run-button"
            >
              {busy ? 'Running…' : 'Run'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleRunExplain}
              disabled={busy || !code.trim()}
              data-testid="code-sandbox-run-explain-button"
            >
              Run + explain
            </Button>
            <Button
              variant="secondary"
              onClick={handleFixAndRun}
              disabled={busy || !code.trim() || !result?.stderr}
              data-testid="code-sandbox-fix-and-run-button"
            >
              Fix + run
            </Button>
            {result && (
              <span
                className="code-sandbox-exit-chip"
                data-ok={String(result.exit_code === 0)}
                data-testid="code-sandbox-exit-code"
              >
                exit {result.exit_code}
                {typeof result.duration_ms === 'number' ? ` · ${result.duration_ms}ms` : ''}
              </span>
            )}
          </div>

          <div className="code-sandbox-output-grid">
            <div className="code-sandbox-output-pane" data-status={status}>
              <div className="code-sandbox-output-label">stdout</div>
              <pre data-testid="code-sandbox-stdout">{result?.stdout ?? ''}</pre>
            </div>
            <div className="code-sandbox-output-pane" data-status={status}>
              <div className="code-sandbox-output-label">stderr</div>
              <pre data-testid="code-sandbox-stderr">{result?.stderr ?? ''}</pre>
            </div>
          </div>

          {explanation && (
            <div className="dev-card" data-testid="code-sandbox-explanation">
              <div className="devtools-b-section-header">
                <h3>Explanation</h3>
              </div>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  margin: 0,
                }}
              >
                {explanation}
              </pre>
            </div>
          )}
        </div>

        <aside className="code-sandbox-history" data-testid="code-sandbox-history">
          <div className="devtools-b-section-header">
            <h3>History</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistory([])}
              disabled={history.length === 0}
            >
              Clear
            </Button>
          </div>
          {history.length === 0 ? (
            <div className="dev-placeholder-hint">No runs yet.</div>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                className="code-sandbox-history-row"
                onClick={() => restoreHistory(h)}
                data-testid="code-sandbox-history-row"
              >
                <span>{h.language}</span>
                <span
                  className="code-sandbox-exit-chip"
                  data-ok={String(h.result.exit_code === 0)}
                >
                  exit {h.result.exit_code}
                </span>
              </div>
            ))
          )}
        </aside>
      </div>
    </GlassPanel>
  );
}
