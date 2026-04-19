// src/features/dev-tools/Canvas.tsx — Plan 07-03 Task 1 (DEV-04).
//
// Real body per D-175 — thin code-sandbox wrapper over sandbox_run +
// sandbox_detect_language, with honest deferral for the interactive canvas.
//
// The "canvas" route ships as a code runner in Phase 7 because that's what the
// backend exposes today (code_sandbox.rs). Full interactive whiteboard /
// drawing surface is Phase 9 polish.
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-175

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel, Button, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { sandboxRun, sandboxDetectLanguage } from '@/lib/tauri/dev_tools';
import type { SandboxResult } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-a.css';

const LANGUAGES = ['python', 'bash', 'node', 'ruby', 'go', 'rust'] as const;
const DEFAULT_CODE = 'print("hello from the canvas")';
const DETECT_DEBOUNCE_MS = 500;

export function Canvas() {
  const toast = useToast();

  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [language, setLanguage] = useState<string>('python');
  const [autoDetect, setAutoDetect] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SandboxResult | null>(null);

  const debounceTimer = useRef<number | null>(null);

  // Debounced auto-detect when code changes + autoDetect is on.
  useEffect(() => {
    if (!autoDetect) return;
    if (debounceTimer.current !== null) {
      window.clearTimeout(debounceTimer.current);
    }
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    debounceTimer.current = window.setTimeout(() => {
      sandboxDetectLanguage(trimmed)
        .then((lang) => {
          if (lang && (LANGUAGES as readonly string[]).includes(lang)) {
            setLanguage(lang);
          }
        })
        .catch(() => {
          /* silent — detection is a hint, not an error path */
        });
    }, DETECT_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    };
  }, [code, autoDetect]);

  const runCode = useCallback(async () => {
    const body = code.trim();
    if (body.length === 0) return;
    setRunning(true);
    try {
      const res = await sandboxRun({ language, code: body });
      setResult(res);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Sandbox run failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }, [code, language, toast]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="canvas-root">
      <div style={{ marginBottom: 'var(--s-2)' }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            color: 'var(--t-1)',
            margin: 0,
          }}
        >
          Canvas
        </h2>
        <p style={{ color: 'var(--t-3)', fontSize: 13, margin: '4px 0 0' }}>
          Run code and inspect output below. A full interactive canvas ships in Phase 9
          polish.
        </p>
      </div>

      <div className="canvas-layout">
        <div className="canvas-editor">
          <div
            style={{
              display: 'flex',
              gap: 'var(--s-1)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: 'var(--t-3)', fontSize: 12 }}>Language:</span>
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                className="dev-tab-pill"
                data-active={language === lang}
                onClick={() => {
                  setLanguage(lang);
                  setAutoDetect(false);
                }}
                data-testid={`canvas-lang-${lang}`}
              >
                {lang}
              </button>
            ))}
            <label
              style={{
                color: 'var(--t-3)',
                fontSize: 12,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                marginLeft: 'var(--s-2)',
              }}
            >
              <input
                type="checkbox"
                checked={autoDetect}
                onChange={(e) => setAutoDetect(e.target.checked)}
                data-testid="canvas-auto-detect"
              />
              Auto-detect
            </label>
          </div>

          <textarea
            className="canvas-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            data-testid="canvas-code"
            placeholder="Write code here; auto-detection will pick a language."
            aria-label="Code to run"
          />

          <div style={{ display: 'flex', gap: 'var(--s-1)', alignItems: 'center' }}>
            <Button
              variant="primary"
              onClick={runCode}
              disabled={running || code.trim().length === 0}
              data-testid="canvas-run-button"
            >
              {running ? 'Running…' : 'Run'}
            </Button>
            {result && (
              <>
                <Pill tone={result.exit_code === 0 ? 'free' : 'new'}>
                  exit {result.exit_code}
                </Pill>
                <span style={{ color: 'var(--t-3)', fontSize: 12 }}>
                  {result.duration_ms}ms · {result.language}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="canvas-output-grid">
          <div>
            <div className="canvas-output-label">stdout</div>
            <pre
              className="canvas-output-pane"
              data-status={result?.exit_code === 0 ? 'complete' : undefined}
              data-testid="canvas-stdout"
            >
              {result?.stdout ?? ''}
            </pre>
          </div>
          <div>
            <div className="canvas-output-label">stderr</div>
            <pre
              className="canvas-output-pane"
              data-status={
                result && result.exit_code !== 0 ? 'failed' : undefined
              }
              data-testid="canvas-stderr"
            >
              {result?.stderr ?? ''}
            </pre>
          </div>
        </div>

        <div className="deferred-card" data-testid="canvas-deferred-card">
          <h3>Interactive canvas</h3>
          <p>
            Drawing, whiteboarding, and visual programming ship in Phase 9 polish. The
            current surface runs code through the Rust sandbox only.
          </p>
          {import.meta.env.DEV && (
            <p>
              <code>route-id: canvas</code>
            </p>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
