import React, { memo, useCallback, useEffect, useRef, useState, Component, useMemo } from "react";
import { Message, ToolExecution } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { ActiveWindowInfo, ContextSuggestion } from "../hooks/useContextAwareness";
import ReactMarkdown from "react-markdown";
import TypingIndicator from "./TypingIndicator";
import MessageReactions from "./MessageReactions";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import go from "highlight.js/lib/languages/go";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("go", go);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);

interface Props {
  messages: Message[];
  loading: boolean;
  toolExecutions: ToolExecution[];
  onQuickAction?: (prompt: string) => void;
  onRetry?: () => void;
  activeWindow?: ActiveWindowInfo | null;
  contextSuggestions?: ContextSuggestion[];
  /** Name of the actively-executing tool, for TypingIndicator */
  activeToolName?: string | null;
}

function sanitizeHighlightHtml(html: string): string {
  return html.replace(/<\/?[^>]+>/g, (tag) => {
    if (/^<span\s/.test(tag) || tag === "</span>") return tag;
    return tag.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors font-mono"
    >
      {copied ? "copied" : (label ?? "copy")}
    </button>
  );
}

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const code = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";
  const isRunnable = ["bash", "sh", "shell", "python", "py", "javascript", "js", "typescript", "ts", ""].includes(lang);
  const lines = code.split("\n");
  const showLineNumbers = lines.length > 5;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setRunOutput(null);
    try {
      let cmd = code;
      if (lang === "python" || lang === "py") cmd = `python3 -c ${JSON.stringify(code)}`;
      else if (lang === "javascript" || lang === "js") cmd = `node -e ${JSON.stringify(code)}`;
      else if (lang === "typescript" || lang === "ts") cmd = `npx ts-node -e ${JSON.stringify(code)}`;
      const result = await invoke<string>("run_code_block", { command: cmd });
      setRunOutput(result);
    } catch (e) {
      setRunOutput(`Error: ${e}`);
    } finally {
      setRunning(false);
    }
  }, [code, lang]);

  useEffect(() => {
    if (!codeRef.current) return;
    let highlighted: string;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
    } catch {
      codeRef.current.textContent = code;
      return;
    }
    const sanitized = sanitizeHighlightHtml(highlighted);
    codeRef.current.innerHTML = sanitized; // eslint-disable-line no-unsanitized/property
  }, [code, lang]);

  return (
    <div className="group/code rounded-lg overflow-hidden border border-blade-border bg-[#0c0c0f] relative">
      {/* Header bar: language label left, actions right */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-blade-surface/50 border-b border-blade-border/50">
        <span className="text-2xs text-blade-accent/60 font-mono font-semibold tracking-wide">{lang || "code"}</span>
        <div className="flex items-center gap-1.5">
          {isRunnable && (
            <button
              onClick={handleRun}
              disabled={running}
              className="text-2xs text-blade-muted hover:text-blade-accent transition-colors disabled:opacity-50 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blade-surface-hover"
              title="Run this code"
            >
              {running ? (
                <span className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              ) : (
                <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" fill="currentColor">
                  <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
                </svg>
              )}
              {running ? "running" : "run"}
            </button>
          )}
          {/* Inline copy button — always visible in header */}
          <button
            onClick={handleCopy}
            className="text-2xs text-blade-muted hover:text-blade-secondary transition-all duration-150 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blade-surface-hover"
            title="Copy code"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      {/* Code with optional line numbers */}
      <div className="flex overflow-x-auto">
        {showLineNumbers && (
          <div
            className="shrink-0 select-none py-3 pr-3 pl-3 text-right text-[0.72rem] leading-relaxed font-mono text-blade-muted/25 border-r border-blade-border/30"
            aria-hidden="true"
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre className={`!m-0 !border-0 !rounded-none overflow-x-auto py-3 flex-1 ${showLineNumbers ? "pl-3" : "px-3"}`}>
          <code ref={codeRef} className="text-[0.8rem] leading-relaxed" />
        </pre>
      </div>
      {runOutput !== null && (
        <div className="border-t border-blade-border bg-blade-bg/70 px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs text-blade-muted font-mono uppercase tracking-wide">output</span>
            <button onClick={() => setRunOutput(null)} className="text-2xs text-blade-muted/50 hover:text-blade-muted">✕</button>
          </div>
          <pre className="text-[0.75rem] text-blade-text/80 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
            {runOutput}
          </pre>
        </div>
      )}
    </div>
  );
}

const MemoCodeBlock = memo(CodeBlock);

/** Typewriter effect — reveals text char by char at ~40ms/char */
function TypewriterText({ text, className }: { text: string; className?: string }) {
  const [revealed, setRevealed] = useState(0);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    setRevealed(0);
    let i = 0;
    // Adaptive speed: faster for longer texts
    const speed = Math.max(8, Math.min(25, 2000 / text.length));
    intervalRef.current = window.setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= text.length) clearInterval(intervalRef.current);
    }, speed);
    return () => clearInterval(intervalRef.current);
  }, [text]);

  return (
    <span className={className}>
      {text.slice(0, revealed)}
      {revealed < text.length && (
        <span className="typing-cursor inline-block w-0.5 h-4 bg-indigo-400/70 ml-0.5 align-middle" />
      )}
    </span>
  );
}

/** Confetti particle for thumbs-up reaction */
function ConfettiParticle({ x, y, color, angle, speed }: {
  x: number; y: number; color: string; angle: number; speed: number;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    width: 6,
    height: 6,
    borderRadius: "1px",
    backgroundColor: color,
    pointerEvents: "none",
    animation: `confetti-particle 0.8s ease-out forwards`,
    "--dx": `${Math.cos(angle) * speed}px`,
    "--dy": `${Math.sin(angle) * speed}px`,
  } as React.CSSProperties;
  return <div style={style} />;
}

/** Tool execution mini-timeline */
function ToolTimeline({ tools }: { tools: ToolExecution[] }) {
  if (tools.length === 0) return null;

  const steps = [
    { label: "Thinking", done: true },
    ...tools.map((t) => ({
      label: t.tool_name.replace(/^blade_/, "").replace(/_/g, " "),
      done: t.status === "completed",
      error: t.is_error,
    })),
    { label: "Responding", done: tools.every((t) => t.status === "completed") },
  ];

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flex items-center gap-1">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                backgroundColor: step.done
                  ? (step as { error?: boolean }).error ? "#f87171" : "#6366f1"
                  : "rgba(99,102,241,0.2)",
                boxShadow: step.done ? "0 0 4px rgba(99,102,241,0.5)" : "none",
                transition: "all 0.3s ease",
              }}
            />
            <span
              className="text-[9px] font-mono uppercase tracking-wide"
              style={{
                color: step.done ? "rgba(165,180,252,0.8)" : "rgba(99,102,241,0.3)",
                transition: "color 0.3s ease",
              }}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="h-px flex-shrink-0"
              style={{
                width: 12,
                backgroundColor: step.done ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.1)",
                transition: "background-color 0.5s ease",
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function DateSeparator({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let label: string;
  if (date.toDateString() === today.toDateString()) label = "Today";
  else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";
  else label = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-blade-border/50" />
      <span className="text-2xs text-blade-muted/50 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-blade-border/50" />
    </div>
  );
}

function shouldShowDateSeparator(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].timestamp).toDateString();
  const curr = new Date(messages[index].timestamp).toDateString();
  return prev !== curr;
}

class MessageBoundary extends Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <div className="pl-3 border-l-2 border-red-500/20 text-2xs text-red-400/60 font-mono py-1">
          [render error — message could not be displayed]
        </div>
      );
    }
    return this.props.children;
  }
}

/** Inline tool execution card — collapsed by default, expandable */
function ToolCard({ tool }: { tool: ToolExecution }) {
  const [expanded, setExpanded] = useState(false);
  const isExecuting = tool.status === "executing";

  let argPreview: string | null = null;
  let argFull: string | null = null;
  if (tool.arguments) {
    try {
      const parsed = JSON.parse(tool.arguments);
      const vals = Object.values(parsed);
      if (vals.length > 0) {
        argFull = JSON.stringify(parsed, null, 2);
        const v = String(vals[0]);
        argPreview = v.length > 50 ? v.slice(0, 48) + "…" : v;
      }
    } catch {
      argPreview = tool.arguments.slice(0, 50);
      argFull = tool.arguments;
    }
  }

  const displayName = tool.tool_name.replace(/^blade_/, "").replace(/_/g, " ");
  const riskColor =
    tool.risk === "Blocked" ? "text-red-400/70 bg-red-400/5 border-red-400/15" :
    tool.risk === "Ask"     ? "text-amber-400/70 bg-amber-400/5 border-amber-400/15" :
                              "text-blade-muted/60 bg-blade-surface border-blade-border/60";

  const statusIcon = isExecuting ? (
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-slow ${
      tool.risk === "Blocked" ? "bg-red-400" : tool.risk === "Ask" ? "bg-amber-400" : "bg-blade-accent"
    }`} />
  ) : tool.is_error ? (
    <span className="text-red-400/70 text-2xs shrink-0">✗</span>
  ) : (
    <span className="text-emerald-400/70 text-2xs shrink-0">✓</span>
  );

  return (
    <div className={`rounded-lg border text-2xs font-mono overflow-hidden transition-all ${riskColor}`}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {statusIcon}
        <span className="shrink-0">&#128295;</span>
        <span className="font-semibold">{displayName}</span>
        {argPreview && !expanded && (
          <span className="text-blade-muted/40 truncate flex-1">{argPreview}</span>
        )}
        {tool.completed_at && (
          <span className="text-blade-muted/30 ml-auto shrink-0">
            {((tool.completed_at - tool.started_at) / 1000).toFixed(1)}s
          </span>
        )}
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 shrink-0 ml-1 text-blade-muted/40 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expanded detail — smooth height transition via grid-rows trick */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-blade-border/40 bg-blade-bg/30 px-2.5 py-2 space-y-2">
            {argFull && (
              <div>
                <div className="text-blade-muted/40 uppercase tracking-wide text-[9px] mb-1">Input</div>
                <pre className="text-blade-muted/70 whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto text-[0.7rem]">
                  {argFull}
                </pre>
              </div>
            )}
            {tool.result && (
              <div>
                <div className={`text-[9px] uppercase tracking-wide mb-1 ${tool.is_error ? "text-red-400/50" : "text-emerald-400/50"}`}>
                  {tool.is_error ? "Error" : "Result"}
                </div>
                <pre className={`whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto text-[0.7rem] ${
                  tool.is_error ? "text-red-400/60" : "text-blade-muted/60"
                }`}>
                  {tool.result}
                </pre>
              </div>
            )}
            {isExecuting && (
              <div className="text-blade-muted/40 italic">Running...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MessageMetaProps {
  msg: Message;
  tools: ToolExecution[];
}

/** Hover metadata row shown below assistant messages */
function MessageMeta({ msg, tools }: MessageMetaProps) {
  const words = msg.content?.split(/\s+/).filter(Boolean).length ?? 0;
  const time = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <span className="text-2xs text-blade-muted/50">{time}</span>
      {words > 0 && <span className="text-2xs text-blade-muted/30">{words}w</span>}
      {tools.length > 0 && (
        <span className="text-2xs text-blade-muted/30 font-mono">
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  msg,
  isLast,
  isFirstMessage,
  onRetry,
  relatedTools,
}: {
  msg: Message;
  isLast?: boolean;
  isFirstMessage?: boolean;
  onRetry?: () => void;
  relatedTools: ToolExecution[];
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confetti, setConfetti] = useState<Array<{ id: number; x: number; y: number; color: string; angle: number; speed: number }>>([]);
  const isUser = msg.role === "user";

  const fireConfetti = useCallback((e: React.MouseEvent) => {
    const colors = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8", "#fbbf24"];
    const particles = Array.from({ length: 12 }, (_, i) => ({
      id: Date.now() + i,
      x: e.clientX,
      y: e.clientY,
      color: colors[i % colors.length],
      angle: (i / 12) * Math.PI * 2,
      speed: 40 + Math.random() * 40,
    }));
    setConfetti(particles);
    setTimeout(() => setConfetti([]), 900);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [msg.content]);

  return (
    <>
      {/* Confetti particles — rendered at fixed position */}
      {confetti.map((p) => (
        <ConfettiParticle key={p.id} x={p.x} y={p.y} color={p.color} angle={p.angle} speed={p.speed} />
      ))}
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={handleDoubleClick}
    >
      <div className={`relative group ${isUser ? "max-w-[75%]" : "max-w-[85%]"}`}>
        {copied && (
          <div className={`absolute -top-6 ${isUser ? "right-0" : "left-3"} text-2xs text-blade-accent animate-fade-in`}>
            copied
          </div>
        )}
        {isUser ? (
          /* User: gradient pill — dark indigo to accent */
          <div
            className="rounded-2xl rounded-br-md px-4 py-2 text-[0.8125rem] leading-relaxed text-white/95"
            style={{
              background: "linear-gradient(135deg, rgba(55,48,107,0.95) 0%, rgba(79,70,229,0.92) 60%, rgba(99,102,241,0.88) 100%)",
              boxShadow: "0 2px 16px rgba(99,102,241,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            {msg.image_base64 && (
              <img
                src={
                  msg.image_base64.startsWith("data:")
                    ? msg.image_base64
                    : `data:image/png;base64,${msg.image_base64}`
                }
                alt="Attached image"
                className="rounded-lg max-w-full max-h-40 mb-2 opacity-90"
              />
            )}
            <div className="message-markdown message-markdown-user">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ) : (
          /* Assistant: left accent line — indigo 2px */
          <div
            className={`pl-3 border-l-2 ${msg.isAck ? "border-blade-accent/30" : "border-indigo-500/60"}`}
            style={!msg.isAck ? {
              borderImage: "linear-gradient(180deg, rgba(99,102,241,0.8) 0%, rgba(139,92,246,0.4) 100%) 1",
            } : undefined}
          >
            {msg.image_base64 && (
              <img
                src={
                  msg.image_base64.startsWith("data:")
                    ? msg.image_base64
                    : `data:image/png;base64,${msg.image_base64}`
                }
                alt="Attached image"
                className="rounded-lg max-w-full max-h-48 mb-3 border border-blade-border"
              />
            )}
            {isFirstMessage && !msg.isAck && msg.content && msg.content.length < 400 ? (
              /* Typewriter reveal for first assistant message in new conversations */
              <div className={`message-markdown text-[0.8125rem] text-blade-text/90`}>
                <TypewriterText text={msg.content} />
              </div>
            ) : (
              <div className={`message-markdown text-[0.8125rem] ${msg.isAck ? "text-blade-text/40 italic" : "text-blade-text/90"}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...rest }) {
                      const isInline = !className && typeof children === "string" && !children.includes("\n");
                      if (isInline) {
                        return <code className={className} {...rest}>{children}</code>;
                      }
                      return <MemoCodeBlock className={className}>{children}</MemoCodeBlock>;
                    },
                    pre({ children }) {
                      return <>{children}</>;
                    },
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
            {/* Tool mini-timeline */}
            {relatedTools.length > 0 && <ToolTimeline tools={relatedTools} />}
            {msg.refined && (
              <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '8px', letterSpacing: '0.05em' }}>
                ✦ refined
              </span>
            )}
            {/* Message metadata — visible on hover */}
            <MessageMeta msg={msg} tools={relatedTools} />
          </div>
        )}
        {/* Action tray — hover only (user messages) */}
        {isUser && hovered && (
          <div className={`absolute -bottom-5 ${isUser ? "right-0" : "left-3"} flex items-center gap-2`}>
            <span className="text-2xs text-blade-muted/50">
              {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            {msg.content && (
              <span className="text-2xs text-blade-muted/30">
                {msg.content.split(/\s+/).filter(Boolean).length}w
              </span>
            )}
          </div>
        )}
        {/* Assistant action tray */}
        {!isUser && hovered && (
          <div className="flex items-center gap-2 mt-1">
            {msg.content && <CopyButton text={msg.content} label="copy" />}
            {isLast && onRetry && (
              <button
                onClick={onRetry}
                className="text-2xs text-blade-muted hover:text-blade-accent transition-colors font-mono"
                title="Regenerate response"
              >
                ↻
              </button>
            )}
            {<MessageReactions messageId={msg.id} messageContent={msg.content} visible={hovered} onThumbsUp={fireConfetti} />}
          </div>
        )}
      </div>
    </div>
    </>
  );
});


// Premium empty-state suggestion cards (4 primary + 2 secondary)
const WELCOME_SUGGESTIONS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    label: "What's on my screen?",
    desc: "Capture + analyze",
    prompt: "Take a screenshot and tell me what you see. Is there anything I should know about?",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    ),
    label: "Morning briefing",
    desc: "Priorities + context",
    prompt: "Give me a morning briefing — what should I focus on today? Include anything relevant from my recent context.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    label: "Review my code",
    desc: "Quality + suggestions",
    prompt: "Review the code I'm currently working on. Look for bugs, style issues, and improvements.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
    label: "Search my files",
    desc: "Local file search",
    prompt: "Search my files and help me find what I need. What files are in my current directory?",
  },
] as const;

const EXAMPLE_PROMPTS = [
  { label: "Debug screen", prompt: "Take a screenshot and help me debug what you see", icon: "⊡" },
  { label: "Last commit", prompt: "What changed in the last git commit?", icon: "⌥" },
  { label: "Explain codebase", prompt: "Give me a quick overview of the current project structure", icon: "◈" },
  { label: "Research", prompt: "/research ", icon: "◎" },
  { label: "Swarm agents", prompt: "/swarm ", icon: "⊕" },
  { label: "Screen timeline", prompt: "/timeline", icon: "◷" },
] as const;

export function MessageList({
  messages,
  loading,
  toolExecutions,
  onQuickAction,
  onRetry,
  activeWindow,
  activeToolName,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isNearBottomRef = useRef(true);
  // Track the count of messages when user last scrolled away — any new msgs show pill
  const lastSeenCountRef = useRef(messages.length);

  // Only auto-scroll when user is already near the bottom (within 80px).
  // This lets users scroll up to read history without being yanked back down.
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      lastSeenCountRef.current = messages.length;
      setShowNewPill(false);
    } else if (messages.length > lastSeenCountRef.current) {
      // User scrolled up and new messages arrived
      setShowNewPill(true);
    }
  }, [messages, loading, toolExecutions]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasNear = isNearBottomRef.current;
    isNearBottomRef.current = distFromBottom < 80;
    setShowScrollBtn(distFromBottom > 200);
    if (isNearBottomRef.current && !wasNear) {
      // User scrolled back to bottom — clear pill
      setShowNewPill(false);
      lastSeenCountRef.current = messages.length;
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowNewPill(false);
    lastSeenCountRef.current = messages.length;
  }, [messages.length]);

  const activeTools = toolExecutions.filter((t) => t.status === "executing");
  const recentCompleted = toolExecutions.filter(
    (t) => t.status === "completed" && t.completed_at && Date.now() - t.completed_at < 4000
  );
  const focusLabel = activeWindow?.title?.trim() || activeWindow?.process_name?.trim() || null;

  // Track the index of the first assistant message (for typewriter effect)
  const firstAssistantIdx = useMemo(
    () => messages.findIndex((m) => m.role === "assistant"),
    // Only recalculate when conversation resets (messages go from 0 to >0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages.length === 0 ? 0 : messages[0]?.id]
  );

  // Group completed tool executions by rough "response window" — all tools from
  // the last assistant turn (since the last user message timestamp)
  const lastUserTimestamp = [...messages].reverse().find((m) => m.role === "user")?.timestamp ?? 0;
  const toolsForLastTurn = toolExecutions.filter(
    (t) => t.status === "completed" && t.started_at >= lastUserTimestamp
  );

  return (
    <div className="flex-1 overflow-y-auto relative" ref={scrollRef} onScroll={handleScroll}>
      {/* Scroll to bottom button */}
      {showScrollBtn && !showNewPill && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-6 z-20 w-8 h-8 rounded-full bg-blade-surface border border-blade-border shadow-lg flex items-center justify-center text-blade-muted hover:text-blade-accent hover:border-blade-accent/30 transition-all animate-fade-in"
          aria-label="Scroll to bottom"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      )}

      {/* New messages pill — appears when user is scrolled up and new messages arrive */}
      {showNewPill && (
        <button
          onClick={scrollToBottom}
          className="new-messages-pill fixed bottom-24 left-1/2 z-20 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-blade-accent text-white text-2xs font-semibold shadow-glow-accent-sm flex items-center gap-1.5 animate-fade-in"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
          New messages
        </button>
      )}

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 select-none">
            {/* BLADE wordmark + logo */}
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <div className="relative w-12 h-12 rounded-2xl bg-blade-surface border border-blade-border/80 flex items-center justify-center shadow-surface-md">
                <div className="w-3 h-3 rounded-full bg-blade-accent shadow-[0_0_12px_rgba(99,102,241,0.6)]" />
                <div className="absolute inset-0 rounded-2xl bg-blade-accent/5" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-semibold text-blade-text tracking-tight">
                  What can I help with?
                </h2>
                <p className="text-blade-muted/50 text-[0.75rem] mt-1 text-center max-w-[240px] leading-relaxed">
                  {focusLabel
                    ? `Focused on ${focusLabel}`
                    : "Your local AI — screen · voice · tools · memory"}
                </p>
              </div>
            </div>

            {/* 4 primary suggestion cards */}
            {onQuickAction && (
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-[380px]">
                {WELCOME_SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.label}
                    onClick={() => onQuickAction(s.prompt)}
                    className="interactive text-left p-3.5 rounded-xl border border-blade-border/60 bg-blade-surface/60 hover:bg-blade-surface hover:border-blade-accent/20 transition-all duration-200 group"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-blade-muted/50 group-hover:text-blade-accent/70 transition-colors">
                        {s.icon}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-blade-secondary group-hover:text-blade-text transition-colors leading-snug">
                      {s.label}
                    </p>
                    <p className="text-2xs text-blade-muted/40 mt-0.5 leading-tight">{s.desc}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Keyboard hints */}
            <div className="flex items-center gap-3 text-[0.65rem] text-blade-muted/30 font-mono tracking-wider">
              <span>/ commands</span>
              <span>·</span>
              <span>Ctrl+K</span>
              <span>·</span>
              <span>paste image</span>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
          // Attribute completed tools to assistant messages that came after them
          const nextMsg = messages[idx + 1];
          const msgEnd = nextMsg?.timestamp ?? Date.now();
          const related = msg.role === "assistant"
            ? toolsForLastTurn.filter(
                (t) => t.started_at >= (messages[idx - 1]?.timestamp ?? 0) && t.started_at < msgEnd
              )
            : [];
          // Apply entrance animation only to recent messages (last 2 messages)
          const isNew = idx >= messages.length - 2;
          return (
            <div
              key={msg.id}
              style={isNew ? { animation: "messageIn 0.3s ease-out" } : undefined}
            >
              {shouldShowDateSeparator(messages, idx) && (
                <DateSeparator timestamp={msg.timestamp} />
              )}
              <MessageBoundary>
                <MessageBubble
                  msg={msg}
                  isLast={isLastAssistant}
                  isFirstMessage={idx === firstAssistantIdx && messages.length <= 2}
                  onRetry={isLastAssistant ? onRetry : undefined}
                  relatedTools={related}
                />
              </MessageBoundary>
            </div>
          );
        })}

        {/* Inline tool execution cards for active / recently completed tools */}
        {(activeTools.length > 0 || recentCompleted.length > 0) && (
          <div className="flex justify-start animate-fade-in">
            <div className="pl-3 border-l-2 border-blade-border space-y-1.5 w-full max-w-lg">
              {activeTools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
              {recentCompleted.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          </div>
        )}

        {loading && activeTools.length === 0 && recentCompleted.length === 0 && (
          <div className="flex justify-start">
            <TypingIndicator visible activeToolName={activeToolName} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
