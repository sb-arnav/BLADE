// src/features/dev-tools/Terminal.tsx — Plan 07-03 Task 1 (DEV-01).
//
// SC-1 falsifier: "Terminal routes bash through `native_tools.rs` and returns
// output". Real body per D-172 — line-oriented scrollback over run_shell, a
// separate 'Run code block' Dialog over run_code_block, and Prefs-persisted
// cwd.
//
// Pattern: @.planning/phases/07-dev-tools-admin/07-PATTERNS.md §3 verbatim.
// No PTY (Phase 9 polish). No shell escaping client-side (Rust-side concern,
// T-07-03-01 accepted).
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 1
// @see src/lib/tauri/dev_tools.ts (runShell, runCodeBlock)

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel, Button, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import { runShell, runCodeBlock } from '@/lib/tauri/dev_tools';
import type { TerminalLine } from './types';
import './dev-tools.css';
import './dev-tools-rich-a.css';

const LANGUAGE_OPTIONS = ['bash', 'sh', 'python', 'node', 'ruby'] as const;

export function Terminal() {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();
  const cwd = (prefs['devTools.terminal.cwd'] as string | undefined) ?? '~';

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeBlockOpen, setCodeBlockOpen] = useState(false);
  const [codeBlockLanguage, setCodeBlockLanguage] = useState<string>('bash');
  const [codeBlockBody, setCodeBlockBody] = useState('');
  const [codeBlockBusy, setCodeBlockBusy] = useState(false);
  const [cwdDraft, setCwdDraft] = useState<string>(cwd);

  const scrollRef = useRef<HTMLPreElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Sync cwd draft when underlying pref changes externally.
  useEffect(() => {
    setCwdDraft(cwd);
  }, [cwd]);

  const pushLines = useCallback((next: TerminalLine[]) => {
    if (next.length === 0) return;
    setLines((prev) => [...prev, ...next]);
  }, []);

  const submit = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setInput('');
    setBusy(true);
    pushLines([{ type: 'cmd', text: `$ ${cmd}` }]);
    try {
      const text = await runShell({ command: cmd, cwd });
      // run_shell returns combined stdout+stderr as a single string per
      // Plan 07-02 wrapper note — treat as stdout for display.
      if (text.trim().length > 0) {
        pushLines([{ type: 'stdout', text }]);
      }
    } catch (err) {
      pushLines([
        { type: 'stderr', text: err instanceof Error ? err.message : String(err) },
      ]);
      toast.show({
        type: 'error',
        title: 'Shell command failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [input, busy, cwd, pushLines, toast]);

  const clear = useCallback(() => setLines([]), []);

  const saveCwd = useCallback(() => {
    const next = cwdDraft.trim();
    if (next.length === 0) return;
    setPref('devTools.terminal.cwd', next);
    toast.show({ type: 'success', title: `cwd set to ${next}` });
  }, [cwdDraft, setPref, toast]);

  const runCode = useCallback(async () => {
    const body = codeBlockBody.trim();
    if (body.length === 0) return;
    setCodeBlockBusy(true);
    try {
      // Rust's run_code_block takes a single `command` string despite the
      // name; for non-bash languages we wrap the body in a `$LANG -c '...'`
      // invocation so the shell handles the dispatch (D-172 note).
      const wrapped =
        codeBlockLanguage === 'bash' || codeBlockLanguage === 'sh'
          ? body
          : `${codeBlockLanguage} -c ${JSON.stringify(body)}`;
      pushLines([
        { type: 'cmd', text: `# run_code_block (${codeBlockLanguage})` },
        { type: 'cmd', text: body },
      ]);
      const text = await runCodeBlock(wrapped);
      if (text.trim().length > 0) {
        // Heuristic: if the output mentions error/traceback/non-zero exit, tint
        // as stderr. Otherwise stdout. Low-risk Rule 2 additive, not in plan.
        const looksError = /error|traceback|non-zero/i.test(text);
        pushLines([{ type: looksError ? 'stderr' : 'stdout', text }]);
      }
      setCodeBlockOpen(false);
    } catch (err) {
      pushLines([
        { type: 'stderr', text: err instanceof Error ? err.message : String(err) },
      ]);
      toast.show({
        type: 'error',
        title: 'Code block failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCodeBlockBusy(false);
    }
  }, [codeBlockBody, codeBlockLanguage, pushLines, toast]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="terminal-root">
      <div className="terminal-topbar">
        <div style={{ display: 'flex', gap: 'var(--s-1)', alignItems: 'center', flex: 1 }}>
          <span className="terminal-cwd">cwd:</span>
          <Input
            mono
            value={cwdDraft}
            onChange={(e) => setCwdDraft(e.target.value)}
            onBlur={saveCwd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            style={{ width: 260 }}
            placeholder="~"
            data-testid="terminal-cwd-input"
            aria-label="Terminal working directory"
          />
        </div>
        <div className="terminal-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCodeBlockOpen(true)}
            data-testid="terminal-run-code-block"
          >
            Run code block
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            data-testid="terminal-clear"
          >
            Clear
          </Button>
        </div>
      </div>

      <pre ref={scrollRef} className="terminal-scrollback" data-testid="terminal-scrollback">
        {lines.length === 0 ? (
          <span className="terminal-line terminal-line-stdout" style={{ color: 'var(--t-3)' }}>
            {'# terminal ready — bash routed through native_tools.rs\n'}
          </span>
        ) : (
          lines.map((l, i) => (
            <span
              key={i}
              className={`terminal-line terminal-line-${l.type}`}
              data-testid={`terminal-line-${l.type}`}
            >
              {l.text}
              {'\n'}
            </span>
          ))
        )}
      </pre>

      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
          placeholder={busy ? 'Running…' : 'Type a shell command, press Enter'}
          data-testid="terminal-input"
          aria-label="Terminal command input"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <Dialog
        open={codeBlockOpen}
        onClose={() => setCodeBlockOpen(false)}
        ariaLabel="Run code block"
      >
        <h3 className="dialog-title">Run code block</h3>
        <div className="dialog-body">
          <label>
            Language
            <select
              value={codeBlockLanguage}
              onChange={(e) => setCodeBlockLanguage(e.target.value)}
              data-testid="terminal-code-language"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </label>
          <label>
            Code
            <textarea
              value={codeBlockBody}
              onChange={(e) => setCodeBlockBody(e.target.value)}
              placeholder="echo hello"
              data-testid="terminal-code-body"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <Button
            variant="ghost"
            onClick={() => setCodeBlockOpen(false)}
            disabled={codeBlockBusy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={runCode}
            disabled={codeBlockBusy || codeBlockBody.trim().length === 0}
            data-testid="terminal-code-run"
          >
            {codeBlockBusy ? 'Running…' : 'Run'}
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
