import { RefObject, useCallback, useEffect, useState } from "react";

export interface EditorState {
  html: string;
  plainText: string;
  wordCount: number;
  charCount: number;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  isList: boolean;
  isHeading: boolean;
}

export interface EditorAction {
  type: "bold" | "italic" | "code" | "heading" | "list" | "link" | "quote" | "hr" | "clear";
}

const INITIAL_STATE: EditorState = {
  html: "",
  plainText: "",
  wordCount: 0,
  charCount: 0,
  isBold: false,
  isItalic: false,
  isCode: false,
  isList: false,
  isHeading: false,
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** Convert editor HTML to clean markdown. */
function htmlToMarkdown(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(walk).join("");

    switch (tag) {
      case "b":
      case "strong":
        return `**${children}**`;
      case "i":
      case "em":
        return `*${children}*`;
      case "code":
        if (el.parentElement?.tagName.toLowerCase() === "pre") return children;
        return `\`${children}\``;
      case "pre": {
        const codeEl = el.querySelector("code");
        const lang = codeEl?.dataset.lang ?? "";
        const content = codeEl?.textContent ?? el.textContent ?? "";
        return `\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
      }
      case "h1":
        return `\n# ${children}\n`;
      case "h2":
        return `\n## ${children}\n`;
      case "h3":
        return `\n### ${children}\n`;
      case "ul":
        return `\n${children}`;
      case "ol":
        return `\n${children}`;
      case "li": {
        const parent = el.parentElement?.tagName.toLowerCase();
        if (parent === "ol") {
          const idx = Array.from(el.parentElement!.children).indexOf(el) + 1;
          return `${idx}. ${children}\n`;
        }
        return `- ${children}\n`;
      }
      case "blockquote":
        return `\n${children.split("\n").map((l) => `> ${l}`).join("\n")}\n`;
      case "a":
        return `[${children}](${el.getAttribute("href") ?? ""})`;
      case "hr":
        return "\n---\n";
      case "br":
        return "\n";
      case "p":
      case "div":
        return `${children}\n`;
      case "img":
        return `![${el.getAttribute("alt") ?? ""}](${el.getAttribute("src") ?? ""})`;
      default:
        return children;
    }
  }

  return walk(div)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert markdown to simple HTML for the editor. */
function markdownToHtml(md: string): string {
  let html = md;

  // Code blocks first (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre><code data-lang="${lang}">${escapeHtml(code.trimEnd())}</code></pre>`;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // HR
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Line breaks for remaining plain lines
  html = html.replace(/\n/g, "<br>");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function useRichEditor(ref: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<EditorState>(INITIAL_STATE);

  const syncState = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const html = el.innerHTML;
    const plainText = el.innerText ?? "";
    const wordCount = countWords(plainText);
    const charCount = plainText.replace(/\n/g, "").length;

    let isBold = false;
    let isItalic = false;
    let isCode = false;
    let isList = false;
    let isHeading = false;
    try {
      isBold = document.queryCommandState("bold");
      isItalic = document.queryCommandState("italic");
      // Check code/list/heading by looking at selection's parent chain
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.anchorNode;
        while (node && node !== el) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as HTMLElement).tagName.toLowerCase();
            if (tag === "code" || tag === "pre") isCode = true;
            if (tag === "ul" || tag === "ol") isList = true;
            if (tag === "h1" || tag === "h2" || tag === "h3") isHeading = true;
          }
          node = node.parentNode;
        }
      }
    } catch {
      // queryCommandState can throw in some browsers
    }

    setState({ html, plainText, wordCount, charCount, isBold, isItalic, isCode, isList, isHeading });
  }, [ref]);

  // Listen for selection changes and input
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onInput = () => syncState();
    const onSelectionChange = () => {
      if (el.contains(document.activeElement) || el === document.activeElement) {
        syncState();
      }
    };

    el.addEventListener("input", onInput);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      el.removeEventListener("input", onInput);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [ref, syncState]);

  const execCommand = useCallback((action: EditorAction) => {
    const el = ref.current;
    if (!el) return;
    el.focus();

    switch (action.type) {
      case "bold":
        document.execCommand("bold");
        break;
      case "italic":
        document.execCommand("italic");
        break;
      case "code": {
        const sel = window.getSelection();
        if (sel && sel.toString()) {
          const range = sel.getRangeAt(0);
          const code = document.createElement("code");
          code.textContent = sel.toString();
          range.deleteContents();
          range.insertNode(code);
          sel.collapseToEnd();
        }
        break;
      }
      case "heading":
        document.execCommand("formatBlock", false, "h2");
        break;
      case "list":
        document.execCommand("insertUnorderedList");
        break;
      case "link": {
        const url = prompt("Enter URL:");
        if (url) document.execCommand("createLink", false, url);
        break;
      }
      case "quote":
        document.execCommand("formatBlock", false, "blockquote");
        break;
      case "hr":
        document.execCommand("insertHorizontalRule");
        break;
      case "clear":
        document.execCommand("removeFormat");
        document.execCommand("formatBlock", false, "div");
        break;
    }
    syncState();
  }, [ref, syncState]);

  const insertText = useCallback((text: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, text);
    syncState();
  }, [ref, syncState]);

  const insertCodeBlock = useCallback((language: string, code: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const html = `<pre><code data-lang="${language}">${escapeHtml(code)}</code></pre><div><br></div>`;
    document.execCommand("insertHTML", false, html);
    syncState();
  }, [ref, syncState]);

  const insertImage = useCallback((src: string, alt = "") => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertHTML", false, `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;" />`);
    syncState();
  }, [ref, syncState]);

  const getMarkdown = useCallback((): string => {
    const el = ref.current;
    if (!el) return "";
    return htmlToMarkdown(el.innerHTML);
  }, [ref]);

  const setMarkdown = useCallback((md: string) => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = markdownToHtml(md);
    syncState();
  }, [ref, syncState]);

  const focus = useCallback(() => {
    ref.current?.focus();
  }, [ref]);

  const clear = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    syncState();
  }, [ref, syncState]);

  return { state, execCommand, insertText, insertCodeBlock, insertImage, getMarkdown, setMarkdown, focus, clear };
}
