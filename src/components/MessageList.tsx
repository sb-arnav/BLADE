import { Message, ToolExecution } from "../types";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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
  const codeRef = useRef<HTMLElement>(null);
  const code = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";

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
        <CopyButton text={code} />
      </div>
      <pre className="!m-0 !border-0 !rounded-none overflow-x-auto px-3 py-3">
        <code ref={codeRef} className="text-[0.8rem] leading-relaxed" />
      </pre>
    </div>
  );
}

const MemoCodeBlock = memo(CodeBlock);

const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
  const [hovered, setHovered] = useState(false);
  const isUser = msg.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`relative ${isUser ? "max-w-[75%]" : "max-w-[85%]"}`}>
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
        {hovered && !isUser && msg.content && (
          <div className="absolute -bottom-4 left-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text={msg.content} label="copy" />
          </div>
        )}
      </div>
    </div>
  );
});

export function MessageList({ messages, loading, toolExecutions }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, toolExecutions]);

  const activeTools = toolExecutions.filter((t) => t.status === "executing");
  const recentCompleted = toolExecutions.filter(
    (t) => t.status === "completed" && t.completed_at && Date.now() - t.completed_at < 3000
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <div className="w-8 h-8 rounded-xl bg-blade-accent-muted flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-blade-accent" />
            </div>
            <div className="text-center">
              <p className="text-blade-secondary text-sm font-medium">Blade</p>
              <p className="text-blade-muted text-xs mt-1">Ready when you are.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
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
          <div className="flex justify-start animate-fade-in">
            <div className="pl-3 border-l-2 border-blade-accent/30">
              <span className="typing-cursor text-blade-accent text-sm">\u258C</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
