import { Message, ToolExecution } from "../types";
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Sanitize highlight.js output: only allow <span> tags with class attributes.
 * highlight.js only produces <span class="hljs-..."> tags, so this strips
 * anything that isn't a span open/close tag.
 */
function sanitizeHighlightHtml(html: string): string {
  // Allow only <span ...> and </span>, escape everything else
  return html.replace(/<\/?[^>]+>/g, (tag) => {
    if (/^<span\s/.test(tag) || tag === "</span>") return tag;
    return tag.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="text-[10px] text-blade-muted hover:text-blade-text transition-colors font-mono"
    >
      {copied ? "copied" : "copy"}
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
      // Fallback: escape and show as plain text
      codeRef.current.textContent = code;
      return;
    }

    // sanitizeHighlightHtml strips any tag that isn't <span>...</span>
    // highlight.js output is trusted library output containing only span tags
    // with hljs-* class names derived from language grammar rules
    const sanitized = sanitizeHighlightHtml(highlighted);
    codeRef.current.innerHTML = sanitized; // eslint-disable-line no-unsanitized/property
  }, [code, lang]);

  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-blade-border/50">
        <span className="text-[10px] text-blade-muted font-mono uppercase">{lang || "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="!mt-0 !rounded-t-none overflow-x-auto px-3 py-3">
        <code ref={codeRef} />
      </pre>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const [showCopy, setShowCopy] = useState(false);

  return (
    <div
      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} group`}
      onMouseEnter={() => setShowCopy(true)}
      onMouseLeave={() => setShowCopy(false)}
    >
      <div className="relative max-w-[85%]">
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            msg.role === "user"
              ? "bg-blade-accent text-white"
              : "bg-blade-surface text-blade-text border border-blade-border"
          }`}
        >
          <div className={`message-markdown ${msg.role === "user" ? "message-markdown-user" : ""}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...rest }) {
                  const isInline = !className && typeof children === "string" && !children.includes("\n");
                  if (isInline) {
                    return <code className={className} {...rest}>{children}</code>;
                  }
                  return <CodeBlock className={className}>{children}</CodeBlock>;
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
        {showCopy && msg.role === "assistant" && msg.content && (
          <div className="absolute -bottom-5 right-0">
            <CopyButton text={msg.content} />
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <div className="w-3 h-3 rounded-full bg-blade-accent opacity-60" />
          <p className="text-blade-muted text-sm">What are we working on?</p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}

      {(activeTools.length > 0 || recentCompleted.length > 0) && (
        <div className="flex justify-start">
          <div className="space-y-1">
            {activeTools.map((tool) => (
              <div key={tool.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-blade-muted">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  tool.risk === "Blocked" ? "bg-red-400" : tool.risk === "Ask" ? "bg-amber-400" : "bg-green-400"
                }`} />
                <span className="font-mono">{tool.tool_name}</span>
              </div>
            ))}
            {recentCompleted.map((tool) => (
              <div key={tool.id} className="flex items-center gap-2 rounded-lg px-3 py-1 text-xs text-blade-muted opacity-60">
                <span className={tool.is_error ? "text-red-400" : "text-green-400"}>
                  {tool.is_error ? "x" : "\u2713"}
                </span>
                <span className="font-mono">{tool.tool_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && activeTools.length === 0 && recentCompleted.length === 0 && (
        <div className="flex justify-start">
          <div className="bg-blade-surface border border-blade-border rounded-xl px-4 py-2.5">
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
