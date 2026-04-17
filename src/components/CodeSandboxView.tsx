import React, { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Inline icon helpers (no lucide-react dependency) ─────────────────────────
type IconProps = { size?: number; className?: string };
const Ic = ({ d, size = 14, className = "" }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>
);
const ArrowLeft   = (p: IconProps) => <Ic size={p.size} className={p.className} d="M19 12H5M5 12l7 7M5 12l7-7" />;
const Play        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M5 3l14 9-14 9V3z" />;
const Clock       = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM12 6v6l4 2" />;
const CheckCircle = (p: IconProps) => <Ic size={p.size} className={p.className} d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" />;
const XCircle     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM15 9l-6 6M9 9l6 6" />;
const Wand2       = (p: IconProps) => <Ic size={p.size} className={p.className} d="M15 4l5 5L7 22H2v-5zM12 7l5 5" />;
const BookOpen    = (p: IconProps) => <Ic size={p.size} className={p.className} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />;

// ── Types ─────────────────────────────────────────────────────────────────────

type Language = "python" | "javascript" | "bash" | "rust" | "go";

interface RunOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

interface RecentRun {
  id: string;
  timestamp: string;
  language: Language;
  first_line: string;
  success: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LANGUAGES: { id: Language; label: string; color: string; placeholder: string }[] = [
  {
    id: "python",
    label: "Python",
    color: "text-blue-400 border-blue-700 bg-blue-900/20",
    placeholder: `# Python\nprint("Hello from BLADE sandbox")\n`,
  },
  {
    id: "javascript",
    label: "JavaScript",
    color: "text-yellow-400 border-yellow-700 bg-yellow-900/20",
    placeholder: `// JavaScript\nconsole.log("Hello from BLADE sandbox");\n`,
  },
  {
    id: "bash",
    label: "Bash",
    color: "text-green-400 border-green-700 bg-green-900/20",
    placeholder: `#!/bin/bash\necho "Hello from BLADE sandbox"\n`,
  },
  {
    id: "rust",
    label: "Rust",
    color: "text-orange-400 border-orange-700 bg-orange-900/20",
    placeholder: `fn main() {\n    println!("Hello from BLADE sandbox");\n}\n`,
  },
  {
    id: "go",
    label: "Go",
    color: "text-cyan-400 border-cyan-700 bg-cyan-900/20",
    placeholder: `package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello from BLADE sandbox")\n}\n`,
  },
];

const TIMEOUTS = [
  { label: "5s",   value: 5 },
  { label: "30s",  value: 30 },
  { label: "60s",  value: 60 },
  { label: "300s", value: 300 },
];

const LANG_COLOR: Record<Language, string> = {
  python:     "bg-blue-900/40 text-blue-300 border border-blue-800",
  javascript: "bg-yellow-900/40 text-yellow-300 border border-yellow-800",
  bash:       "bg-green-900/40 text-green-300 border border-green-800",
  rust:       "bg-orange-900/40 text-orange-300 border border-orange-800",
  go:         "bg-cyan-900/40 text-cyan-300 border border-cyan-800",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function now(): string {
  return new Date().toLocaleTimeString();
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CodeSandboxView({ onBack }: { onBack: () => void }) {
  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState(LANGUAGES[0].placeholder);
  const [timeout, setTimeout] = useState(30);

  const [output, setOutput] = useState<RunOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [fixedCode, setFixedCode] = useState<string | null>(null);

  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentLang = LANGUAGES.find((l) => l.id === language)!;

  // ── Run ───────────────────────────────────────────────────────────────────

  const run = useCallback(async (codeToRun?: string) => {
    const src = codeToRun ?? code;
    if (!src.trim()) return;
    setRunning(true);
    setOutput(null);
    setExplanation(null);
    setFixedCode(null);
    try {
      const result = await invoke<RunOutput>("sandbox_run", {
        language,
        code: src,
        timeoutSecs: timeout,
      });
      setOutput(result);
      setRecentRuns((prev) => [
        {
          id: makeId(),
          timestamp: now(),
          language,
          first_line: src.trim().split("\n")[0].slice(0, 60),
          success: result.exit_code === 0,
        },
        ...prev.slice(0, 4),
      ]);
    } catch (e) {
      setOutput({
        stdout: "",
        stderr: String(e),
        exit_code: -1,
        duration_ms: 0,
      });
    } finally {
      setRunning(false);
    }
  }, [code, language, timeout]);

  // ── Fix & Run ─────────────────────────────────────────────────────────────

  const fixAndRun = useCallback(async () => {
    if (!output?.stderr) return;
    setFixing(true);
    setExplanation(null);
    try {
      const result = await invoke<{ fixed_code: string; output: RunOutput }>("sandbox_fix_and_run", {
        language,
        code,
        error: output.stderr,
      });
      if (result) {
        setFixedCode(result.fixed_code);
        setCode(result.fixed_code);
        setOutput(result.output);
        setRecentRuns((prev) => [
          {
            id: makeId(),
            timestamp: now(),
            language,
            first_line: result.fixed_code.trim().split("\n")[0].slice(0, 60),
            success: result.output.exit_code === 0,
          },
          ...prev.slice(0, 4),
        ]);
      }
    } catch (e) {
      setOutput((prev) => prev ? { ...prev, stderr: `Fix failed: ${String(e)}` } : null);
    } finally {
      setFixing(false); }
  }, [code, language, output]);

  // ── Explain ───────────────────────────────────────────────────────────────

  const explain = useCallback(async () => {
    if (!code.trim()) return;
    setExplaining(true);
    setExplanation(null);
    try {
      const result = await invoke<string>("sandbox_run_explain", { language, code });
      setExplanation(result ?? "No explanation returned.");
    } catch (e) {
      setExplanation(`Explain failed: ${String(e)}`);
    } finally {
      setExplaining(false);
    }
  }, [code, language]);

  // ── Language switch ───────────────────────────────────────────────────────

  const switchLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
    setOutput(null);
    setExplanation(null);
    setFixedCode(null);
    const l = LANGUAGES.find((x) => x.id === lang);
    if (l && !code.trim()) setCode(l.placeholder);
  }, [code]);

  // ── Keyboard shortcut ─────────────────────────────────────────────────────

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    // Tab key — insert 4 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newCode = code.slice(0, start) + "    " + code.slice(end);
      setCode(newCode);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
  }, [run, code]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-blade-bg text-[rgba(255,255,255,0.7)] font-mono text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)] shrink-0">
        <button onClick={onBack} className="text-[rgba(255,255,255,0.4)] hover:text-green-400 transition-colors">
          <ArrowLeft size={15} />
        </button>
        <span className="text-green-400 font-bold tracking-widest uppercase text-xs">Code Sandbox</span>
        <div className="flex-1" />

        {/* Timeout selector */}
        <div className="flex items-center gap-1 border border-[rgba(255,255,255,0.1)] rounded px-1">
          <Clock size={11} className="text-[rgba(255,255,255,0.3)]" />
          <select
            className="bg-transparent text-[rgba(255,255,255,0.5)] text-2xs focus:outline-none py-0.5"
            value={timeout}
            onChange={(e) => setTimeout(Number(e.target.value))}
          >
            {TIMEOUTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Explain */}
        <button
          onClick={explain}
          disabled={explaining || !code.trim()}
          className="flex items-center gap-1.5 px-3 py-1 border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] rounded hover:text-purple-300 hover:border-purple-700 transition-colors text-2xs disabled:opacity-40"
        >
          <BookOpen size={12} /> {explaining ? "Explaining…" : "Explain"}
        </button>

        {/* Fix & Run */}
        {output?.stderr && (
          <button
            onClick={fixAndRun}
            disabled={fixing}
            className="flex items-center gap-1.5 px-3 py-1 border border-yellow-700 bg-yellow-900/20 text-yellow-300 rounded hover:bg-yellow-800/30 transition-colors text-2xs disabled:opacity-40"
          >
            <Wand2 size={12} /> {fixing ? "Fixing…" : "Fix & Run"}
          </button>
        )}

        {/* Run */}
        <button
          onClick={() => run()}
          disabled={running || !code.trim()}
          className="flex items-center gap-1.5 px-3 py-1 border border-green-800 bg-green-900/20 text-green-300 rounded hover:bg-green-800/30 transition-colors text-2xs disabled:opacity-40"
        >
          <Play size={12} /> {running ? "Running…" : "▶ Run"}
        </button>
      </div>

      {/* Language tabs */}
      <div className="flex items-center gap-0 border-b border-[rgba(255,255,255,0.07)] shrink-0">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            onClick={() => switchLanguage(l.id)}
            className={`px-4 py-2 text-2xs border-b-2 transition-colors ${
              language === l.id
                ? "border-green-500 text-green-300 bg-green-900/10"
                : "border-transparent text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)] hover:bg-blade-bg/40"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Body: Editor + Output + sidebar */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Editor + Output column */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Fixed code banner */}
          {fixedCode && (
            <div className="px-4 py-1.5 bg-yellow-900/20 border-b border-yellow-800 text-2xs text-yellow-300 flex items-center gap-2 shrink-0">
              <Wand2 size={11} /> Code was fixed and updated. Previous error resolved.
            </div>
          )}

          {/* Code editor */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              className="absolute inset-0 w-full h-full bg-blade-bg text-green-300 font-mono text-xs p-4 resize-none focus:outline-none leading-relaxed caret-green-400 border-0"
              style={{ tabSize: 4 }}
              placeholder={currentLang.placeholder}
            />
          </div>

          {/* Output panel */}
          {(output || running) && (
            <div className="border-t border-[rgba(255,255,255,0.07)] shrink-0 max-h-64 overflow-y-auto bg-blade-bg">
              {/* Output header */}
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[rgba(255,255,255,0.07)] sticky top-0 bg-blade-bg">
                <span className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest">Output</span>
                {output && (
                  <>
                    <span className={`text-2xs px-1.5 py-0.5 rounded border ${
                      output.exit_code === 0
                        ? "bg-green-900/30 text-green-400 border-green-800"
                        : "bg-red-900/30 text-red-400 border-red-800"
                    }`}>
                      exit {output.exit_code}
                    </span>
                    <span className="text-2xs text-[rgba(255,255,255,0.3)] border border-[rgba(255,255,255,0.1)] px-1.5 py-0.5 rounded">
                      {formatDuration(output.duration_ms)}
                    </span>
                    {output.exit_code === 0
                      ? <CheckCircle size={11} className="text-green-400" />
                      : <XCircle size={11} className="text-red-400" />}
                  </>
                )}
                {running && <span className="text-2xs text-yellow-400 animate-pulse">Running…</span>}
              </div>

              {output && (
                <div className="p-4 space-y-3">
                  {output.stdout && (
                    <div>
                      <div className="text-2xs text-[rgba(255,255,255,0.3)] mb-1 uppercase tracking-wider">stdout</div>
                      <pre className="text-green-300 text-2xs font-mono whitespace-pre-wrap leading-relaxed">{output.stdout}</pre>
                    </div>
                  )}
                  {output.stderr && (
                    <div>
                      <div className="text-2xs text-[rgba(255,255,255,0.3)] mb-1 uppercase tracking-wider">stderr</div>
                      <pre className="text-red-400 text-2xs font-mono whitespace-pre-wrap leading-relaxed">{output.stderr}</pre>
                    </div>
                  )}
                  {!output.stdout && !output.stderr && (
                    <div className="text-2xs text-[rgba(255,255,255,0.3)]">(no output)</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Explanation panel */}
          {(explanation || explaining) && (
            <div className="border-t border-[rgba(255,255,255,0.07)] shrink-0 max-h-48 overflow-y-auto bg-blade-bg">
              <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[rgba(255,255,255,0.07)] sticky top-0 bg-blade-bg">
                <BookOpen size={11} className="text-purple-400" />
                <span className="text-2xs text-purple-400 uppercase tracking-widest">Explanation</span>
                {explaining && <span className="text-2xs text-yellow-400 animate-pulse">Thinking…</span>}
              </div>
              {explanation && (
                <div className="p-4 text-2xs text-[rgba(255,255,255,0.7)] leading-relaxed whitespace-pre-wrap font-sans">{explanation}</div>
              )}
            </div>
          )}
        </div>

        {/* Recent runs sidebar */}
        <div className="w-56 border-l border-[rgba(255,255,255,0.07)] flex flex-col shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.07)] text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest flex items-center gap-1">
            <Clock size={10} /> Recent
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
            {recentRuns.length === 0 && (
              <div className="text-2xs text-[rgba(255,255,255,0.2)] p-1">No runs yet</div>
            )}
            {recentRuns.map((r) => (
              <div
                key={r.id}
                className="border border-[rgba(255,255,255,0.07)] rounded p-2 bg-blade-bg/40 hover:bg-blade-bg transition-colors cursor-default"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {r.success
                    ? <CheckCircle size={10} className="text-green-400 shrink-0" />
                    : <XCircle size={10} className="text-red-400 shrink-0" />}
                  <span className={`text-2xs px-1 py-px rounded ${LANG_COLOR[r.language]}`}>
                    {r.language}
                  </span>
                  <span className="text-2xs text-[rgba(255,255,255,0.3)] ml-auto">{r.timestamp}</span>
                </div>
                <div className="text-2xs text-[rgba(255,255,255,0.4)] font-mono truncate">{r.first_line}</div>
              </div>
            ))}
          </div>

          {/* Keyboard hint */}
          <div className="border-t border-[rgba(255,255,255,0.07)] px-3 py-2">
            <div className="text-2xs text-[rgba(255,255,255,0.2)]">Ctrl+Enter to run</div>
            <div className="text-2xs text-[rgba(255,255,255,0.2)]">Tab for indent</div>
          </div>
        </div>
      </div>
    </div>
  );
}
