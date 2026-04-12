import { Message, ToolExecution } from "../types";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
  activeWindow?: ActiveWindowInfo | null;
  contextSuggestions?: ContextSuggestion[];
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
  const codeRef = useRef<HTMLElement>(null);
  const code = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";
  const isRunnable = ["bash", "sh", "shell", "python", "py", "javascript", "js", "typescript", "ts", ""].includes(lang);

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
    <div className="rounded-lg overflow-hidden border border-blade-border bg-[#0c0c0f]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-blade-surface/50">
        <span className="text-2xs text-blade-muted font-mono">{lang || "code"}</span>
        <div className="flex items-center gap-1.5">
          {isRunnable && (
            <button
              onClick={handleRun}
              disabled={running}
              className="text-2xs text-blade-muted hover:text-blade-accent transition-colors disabled:opacity-50 flex items-center gap-1"
              title="Run this code"
            >
              {running ? (
                <span className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
              ) : (
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
                  <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
                </svg>
              )}
              {running ? "running" : "run"}
            </button>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <pre className="!m-0 !border-0 !rounded-none overflow-x-auto px-3 py-3">
        <code ref={codeRef} className="text-[0.8rem] leading-relaxed" />
      </pre>
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

const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const handleDoubleClick = useCallback(() => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [msg.content]);

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={handleDoubleClick}
    >
      <div className={`relative ${isUser ? "max-w-[75%]" : "max-w-[85%]"}`}>
        {copied && (
          <div className={`absolute -top-6 ${isUser ? "right-0" : "left-3"} text-2xs text-blade-accent animate-fade-in`}>
            copied
          </div>
        )}
        {isUser ? (
          /* User: compact pill, subtle accent */
          <div className="rounded-2xl rounded-br-md bg-blade-accent/90 px-4 py-2 text-[0.8125rem] leading-relaxed text-white/95">
            {msg.image_base64 && (
              <img
                src={`data:image/png;base64,${msg.image_base64}`}
                alt="Screenshot"
                className="rounded-lg max-w-full max-h-40 mb-2 opacity-90"
              />
            )}
            <div className="message-markdown message-markdown-user">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ) : (
          /* Assistant: no bubble, just text with left accent line */
          <div className="pl-3 border-l-2 border-blade-border">
            {msg.image_base64 && (
              <img
                src={`data:image/png;base64,${msg.image_base64}`}
                alt="Screenshot"
                className="rounded-lg max-w-full max-h-48 mb-3 border border-blade-border"
              />
            )}
            <div className="message-markdown text-[0.8125rem] text-blade-text/90">
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
          </div>
        )}
        {hovered && (
          <div className={`absolute -bottom-5 ${isUser ? "right-0" : "left-3"} flex items-center gap-2`}>
            <span className="text-2xs text-blade-muted/50">
              {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            {msg.content && (
              <span className="text-2xs text-blade-muted/30">
                {msg.content.split(/\s+/).filter(Boolean).length}w
              </span>
            )}
            {!isUser && msg.content && <CopyButton text={msg.content} label="copy" />}
            {!isUser && <MessageReactions messageId={msg.id} messageContent={msg.content} visible={hovered} />}
          </div>
        )}
      </div>
    </div>
  );
});

const QUICK_ACTIONS = [
  {
    emoji: "💡",
    title: "Brainstorm",
    prompt: "Help me brainstorm ideas for:\n\nGoal:\nAudience or user:\nConstraints:\nWhat I've tried so far:\n",
  },
  {
    emoji: "📝",
    title: "Write",
    prompt: "Help me write this piece.\n\nType of writing:\nTopic:\nTone:\nTarget length:\nKey points to include:\n",
  },
  {
    emoji: "🐛",
    title: "Debug",
    prompt: "Help me debug this issue.\n\nExpected behavior:\nActual behavior:\nError message:\nRelevant code or steps:\n",
  },
  {
    emoji: "📊",
    title: "Analyze",
    prompt: "Analyze this for me:\n\nWhat it is:\nWhat you should look for:\nContext:\n",
  },
  {
    emoji: "🔍",
    title: "Research",
    prompt: "Research this topic for me:\n\nTopic:\nWhat decision I need to make:\nConstraints or preferences:\n",
  },
  {
    emoji: "⚡",
    title: "Explain",
    prompt: "Explain this clearly and simply:\n\nTopic:\nMy current understanding:\nWhat I'm confused about:\n",
  },
];

export function MessageList({
  messages,
  loading,
  toolExecutions,
  onQuickAction,
  activeWindow,
  contextSuggestions,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, toolExecutions]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const activeTools = toolExecutions.filter((t) => t.status === "executing");
  const recentCompleted = toolExecutions.filter(
    (t) => t.status === "completed" && t.completed_at && Date.now() - t.completed_at < 3000
  );
  const focusLabel = activeWindow?.title?.trim() || activeWindow?.process_name?.trim() || null;
  const suggestionList = (contextSuggestions ?? []).slice(0, 4);

  return (
    <div className="flex-1 overflow-y-auto relative" ref={scrollRef} onScroll={handleScroll}>
      {showScrollBtn && (
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
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5">
            <div className="w-10 h-10 rounded-xl bg-blade-accent-muted flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-blade-accent" />
            </div>
            <div className="text-center">
              <p className="text-blade-secondary text-sm font-medium">Blade</p>
              <p className="text-blade-muted text-xs mt-1">
                Your personal desktop intelligence. It can listen, see your screen, use tools, and help with what you are doing right now.
              </p>
            </div>
            <div className="w-full max-w-lg rounded-2xl border border-blade-border bg-blade-surface/50 p-4 animate-fade-in">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs uppercase tracking-[0.2em] text-blade-muted">Live context</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blade-border px-2.5 py-1 text-2xs text-blade-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Voice + screen ready
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blade-border px-2.5 py-1 text-2xs text-blade-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-blade-accent" />
                  Tool actions guarded
                </span>
              </div>
              <div className="mt-3 text-sm text-blade-text">
                {focusLabel ? `I can help with the app in front of you: ${focusLabel}` : "I can work from your current screen, voice, clipboard, files, and tools."}
              </div>
              {suggestionList.length > 0 && onQuickAction ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestionList.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      onClick={() => onQuickAction(suggestion.prompt)}
                      className="rounded-full border border-blade-border bg-blade-bg/70 px-3 py-1.5 text-2xs text-blade-secondary hover:border-blade-accent/30 hover:text-blade-text transition-colors"
                    >
                      <span className="mr-1">{suggestion.icon}</span>
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {onQuickAction && (
              <div className="grid grid-cols-2 gap-2 mt-2 max-w-xs animate-fade-in">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.title}
                    onClick={() => onQuickAction(action.prompt)}
                    className="flex items-center gap-2 rounded-lg bg-blade-surface/50 border border-blade-border/50 hover:border-blade-accent/30 px-3 py-2 text-left transition-colors"
                  >
                    <span className="text-sm">{action.emoji}</span>
                    <span className="text-2xs text-blade-secondary">{action.title}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-4 mt-3 text-2xs text-blade-muted/40">
              <span>mic</span>
              <span>screen</span>
              <span>paste</span>
              <span>Ctrl+K</span>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={msg.id}>
            {shouldShowDateSeparator(messages, idx) && (
              <DateSeparator timestamp={msg.timestamp} />
            )}
            <MessageBubble msg={msg} />
          </div>
        ))}

        {(activeTools.length > 0 || recentCompleted.length > 0) && (
          <div className="flex justify-start animate-fade-in">
            <div className="pl-3 border-l-2 border-blade-border space-y-1">
              {activeTools.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2 py-0.5 text-xs text-blade-muted">
                  <div className={`w-1 h-1 rounded-full animate-pulse-slow ${
                    tool.risk === "Blocked" ? "bg-red-400" : tool.risk === "Ask" ? "bg-amber-400" : "bg-blade-accent"
                  }`} />
                  <span className="font-mono text-2xs">{tool.tool_name}</span>
                </div>
              ))}
              {recentCompleted.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2 py-0.5 text-xs text-blade-muted/50">
                  <span className={`text-2xs ${tool.is_error ? "text-red-400/60" : "text-emerald-400/60"}`}>
                    {tool.is_error ? "\u2717" : "\u2713"}
                  </span>
                  <span className="font-mono text-2xs">{tool.tool_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && activeTools.length === 0 && recentCompleted.length === 0 && (
          <div className="flex justify-start">
            <TypingIndicator visible />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
