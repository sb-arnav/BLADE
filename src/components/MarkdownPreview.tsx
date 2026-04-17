import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";

/* ── Code block (reuses MessageList pattern) ────────────────────── */

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

/* ── MarkdownPreview ─────────────────────────────────────────────── */

interface Props {
  content: string;
  maxHeight?: number;
  className?: string;
}

export function MarkdownPreview({ content, maxHeight, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check if content overflows maxHeight
  useEffect(() => {
    if (!maxHeight || !containerRef.current) {
      setTruncated(false);
      return;
    }
    const el = containerRef.current;
    setTruncated(el.scrollHeight > maxHeight);
  }, [content, maxHeight]);

  const handleCopyAll = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  const effectiveMaxHeight = maxHeight && !expanded ? maxHeight : undefined;

  return (
    <div
      className={`relative group ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Copy all button — top right on hover */}
      {hovered && (
        <button
          onClick={handleCopyAll}
          className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-blade-surface border border-blade-border text-2xs text-blade-muted hover:text-blade-secondary transition-colors animate-fade-in"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}

      {/* Content */}
      <div
        ref={containerRef}
        className="message-markdown text-[0.8125rem] text-blade-text/90 overflow-hidden"
        style={effectiveMaxHeight ? { maxHeight: effectiveMaxHeight, overflow: "hidden" } : undefined}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className: cn, children, ...rest }) {
              const isInline =
                !cn && typeof children === "string" && !children.includes("\n");
              if (isInline) {
                return <code className={cn} {...rest}>{children}</code>;
              }
              return <MemoCodeBlock className={cn}>{children}</MemoCodeBlock>;
            },
            pre({ children }) {
              return <>{children}</>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {/* Gradient fade + Show more */}
      {truncated && !expanded && (
        <div className="relative">
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-blade-surface to-transparent pointer-events-none -mt-12" />
          <button
            onClick={() => setExpanded(true)}
            className="relative z-10 w-full text-center py-1.5 text-2xs text-blade-accent hover:text-blade-accent-hover transition-colors"
          >
            Show more
          </button>
        </div>
      )}

      {/* Collapse */}
      {truncated && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full text-center py-1.5 text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  );
}
