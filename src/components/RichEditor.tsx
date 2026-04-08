import { useCallback, useEffect, useRef, useState, KeyboardEvent } from "react";
import { useRichEditor, EditorAction } from "../hooks/useRichEditor";

interface Props {
  initialContent?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  onSubmit?: (markdown: string) => void;
  minHeight?: number;
}

/* ── Toolbar button ──────────────────────────────────────────────── */

function ToolbarBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`w-7 h-7 rounded flex items-center justify-center text-xs transition-colors ${
        active
          ? "bg-blade-accent-muted text-blade-accent"
          : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-4 bg-blade-border/50 mx-0.5" />;
}

/* ── Main component ──────────────────────────────────────────────── */

export function RichEditor({
  initialContent,
  placeholder = "Start writing...",
  onChange,
  onSubmit,
  minHeight = 160,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const { state, execCommand, getMarkdown, setMarkdown, focus, clear } = useRichEditor(editorRef);
  const [isEmpty, setIsEmpty] = useState(true);
  const initialSet = useRef(false);

  // Set initial content once
  useEffect(() => {
    if (initialContent && !initialSet.current) {
      initialSet.current = true;
      setMarkdown(initialContent);
      setIsEmpty(false);
    }
  }, [initialContent, setMarkdown]);

  // Track empty state
  useEffect(() => {
    const text = state.plainText.trim();
    setIsEmpty(!text);
  }, [state.plainText]);

  // Fire onChange
  useEffect(() => {
    if (!onChange) return;
    const md = getMarkdown();
    onChange(md);
  }, [state.html, onChange, getMarkdown]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+B bold
      if (ctrl && e.key === "b") {
        e.preventDefault();
        execCommand({ type: "bold" });
        return;
      }
      // Ctrl+I italic
      if (ctrl && e.key === "i") {
        e.preventDefault();
        execCommand({ type: "italic" });
        return;
      }
      // Ctrl+Shift+C code
      if (ctrl && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        execCommand({ type: "code" });
        return;
      }
      // Ctrl+Enter submit
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        if (onSubmit) {
          onSubmit(getMarkdown());
        }
        return;
      }
      // Tab — insert 2 spaces instead of moving focus
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
      }
    },
    [execCommand, getMarkdown, onSubmit]
  );

  // Paste: strip formatting, keep only plain text
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const handleAction = useCallback(
    (type: EditorAction["type"]) => () => execCommand({ type }),
    [execCommand]
  );

  const handleSubmit = useCallback(() => {
    if (onSubmit) {
      onSubmit(getMarkdown());
    }
  }, [onSubmit, getMarkdown]);

  return (
    <div className="rounded-xl border border-blade-border bg-blade-surface overflow-hidden flex flex-col">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-blade-border/50 bg-blade-surface/80">
        {/* Text formatting */}
        <ToolbarBtn label="Bold (Ctrl+B)" active={state.isBold} onClick={handleAction("bold")}>
          <span className="font-bold text-[0.7rem]">B</span>
        </ToolbarBtn>
        <ToolbarBtn label="Italic (Ctrl+I)" active={state.isItalic} onClick={handleAction("italic")}>
          <span className="italic text-[0.7rem]">I</span>
        </ToolbarBtn>
        <ToolbarBtn label="Code (Ctrl+Shift+C)" active={state.isCode} onClick={handleAction("code")}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </ToolbarBtn>

        <ToolbarDivider />

        {/* Block formatting */}
        <ToolbarBtn label="Heading" active={state.isHeading} onClick={handleAction("heading")}>
          <span className="font-semibold text-[0.7rem]">H</span>
        </ToolbarBtn>
        <ToolbarBtn label="Bullet list" active={state.isList} onClick={handleAction("list")}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
            <line x1="9" y1="6" x2="21" y2="6" />
            <line x1="9" y1="12" x2="21" y2="12" />
            <line x1="9" y1="18" x2="21" y2="18" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn label="Blockquote" onClick={handleAction("quote")}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C9.591 11.68 11 13.187 11 15a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.917-1.179zM14.583 17.321C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C19.591 11.68 21 13.187 21 15a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.917-1.179z" />
          </svg>
        </ToolbarBtn>

        <ToolbarDivider />

        {/* Insert */}
        <ToolbarBtn label="Insert link" onClick={handleAction("link")}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn label="Horizontal rule" onClick={handleAction("hr")}>
          <span className="text-[0.7rem] font-medium tracking-wider">---</span>
        </ToolbarBtn>

        <ToolbarDivider />

        {/* Clear */}
        <ToolbarBtn label="Clear formatting" onClick={handleAction("clear")}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </ToolbarBtn>
      </div>

      {/* ── Editor area ────────────────────────────────────────────── */}
      <div className="relative flex-1">
        {isEmpty && (
          <div
            className="absolute top-0 left-0 px-4 py-3 text-blade-muted text-[0.8125rem] pointer-events-none select-none"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={focus}
          role="textbox"
          aria-multiline
          aria-placeholder={placeholder}
          className="rich-editor-content outline-none px-4 py-3 text-[0.8125rem] leading-[1.65] text-blade-text overflow-y-auto"
          style={{ minHeight }}
        />
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-blade-border/50 bg-blade-surface/60">
        <div className="flex items-center gap-3 text-2xs text-blade-muted/60">
          <span>{state.wordCount} word{state.wordCount !== 1 ? "s" : ""}</span>
          <span>{state.charCount} char{state.charCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          {!isEmpty && (
            <button
              type="button"
              onClick={() => {
                clear();
                focus();
              }}
              className="text-2xs text-blade-muted hover:text-red-400 transition-colors px-1"
            >
              Clear
            </button>
          )}
          {onSubmit && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isEmpty}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                isEmpty
                  ? "text-blade-muted/30 cursor-not-allowed"
                  : "bg-blade-accent text-white hover:bg-blade-accent-hover"
              }`}
            >
              Submit
              <kbd className="ml-1.5 text-2xs opacity-60">Ctrl+Enter</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Editor styles ─────────────────────────────────────────────────
   These are injected as a <style> tag so we keep all editor CSS
   co-located. Tailwind handles the rest. */

const EDITOR_STYLES = `
.rich-editor-content {
  word-break: break-word;
  caret-color: var(--tw-blade-accent, #818cf8);
}
.rich-editor-content:focus {
  outline: none;
}
.rich-editor-content strong,
.rich-editor-content b {
  font-weight: 600;
  color: #ececef;
}
.rich-editor-content em,
.rich-editor-content i {
  font-style: italic;
}
.rich-editor-content code {
  font-family: "JetBrains Mono", "SF Mono", Consolas, monospace;
  font-size: 0.85em;
  background: rgba(39, 39, 42, 0.6);
  padding: 0.15rem 0.4rem;
  border-radius: 0.3rem;
  color: #e4e4e7;
}
.rich-editor-content pre {
  background: #0c0c0f;
  border: 1px solid #1c1c22;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  margin: 0.5rem 0;
  overflow-x: auto;
}
.rich-editor-content pre code {
  background: transparent;
  padding: 0;
  font-size: 0.8em;
  line-height: 1.6;
  color: #d4d4d8;
}
.rich-editor-content a {
  color: #818cf8;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.rich-editor-content a:hover {
  color: #a5b4fc;
}
.rich-editor-content h1 {
  font-size: 1.4em;
  font-weight: 700;
  margin: 0.75rem 0 0.25rem;
  color: #ececef;
}
.rich-editor-content h2 {
  font-size: 1.2em;
  font-weight: 600;
  margin: 0.6rem 0 0.2rem;
  color: #ececef;
}
.rich-editor-content h3 {
  font-size: 1.05em;
  font-weight: 600;
  margin: 0.5rem 0 0.15rem;
  color: #ececef;
}
.rich-editor-content ul,
.rich-editor-content ol {
  padding-left: 1.25rem;
  margin: 0.4rem 0;
}
.rich-editor-content ul {
  list-style-type: disc;
}
.rich-editor-content ol {
  list-style-type: decimal;
}
.rich-editor-content li {
  margin: 0.15rem 0;
}
.rich-editor-content blockquote {
  border-left: 2px solid #27272a;
  padding-left: 0.75rem;
  color: #a1a1aa;
  margin: 0.5rem 0;
}
.rich-editor-content hr {
  border: none;
  border-top: 1px solid #1c1c22;
  margin: 0.75rem 0;
}
.rich-editor-content img {
  max-width: 100%;
  border-radius: 0.5rem;
  margin: 0.5rem 0;
}
.rich-editor-content p {
  margin: 0.4rem 0;
}
.rich-editor-content > :first-child {
  margin-top: 0;
}
.rich-editor-content > :last-child {
  margin-bottom: 0;
}
`;

// Inject styles once
if (typeof document !== "undefined") {
  const id = "rich-editor-styles";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = EDITOR_STYLES;
    document.head.appendChild(style);
  }
}
