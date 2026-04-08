import { useState, useCallback, useMemo } from "react";

/**
 * Markdown Editor — full-featured markdown editing with live preview,
 * table of contents, word count, and export options.
 */

export interface MarkdownDocument {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  charCount: number;
  lineCount: number;
  headings: Array<{ level: number; text: string; line: number }>;
  links: Array<{ text: string; url: string; line: number }>;
  codeBlocks: Array<{ language: string; line: number; lines: number }>;
  images: Array<{ alt: string; url: string; line: number }>;
  readingTime: number; // minutes
  createdAt: number;
  updatedAt: number;
}

export interface MarkdownStats {
  wordCount: number;
  charCount: number;
  lineCount: number;
  paragraphs: number;
  sentences: number;
  headingCount: number;
  linkCount: number;
  codeBlockCount: number;
  imageCount: number;
  readingTime: number;
}

function analyzeMarkdown(content: string): {
  stats: MarkdownStats;
  headings: MarkdownDocument["headings"];
  links: MarkdownDocument["links"];
  codeBlocks: MarkdownDocument["codeBlocks"];
  images: MarkdownDocument["images"];
} {
  const lines = content.split("\n");
  const words = content.split(/\s+/).filter(Boolean);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const headings: MarkdownDocument["headings"] = [];
  const links: MarkdownDocument["links"] = [];
  const codeBlocks: MarkdownDocument["codeBlocks"] = [];
  const images: MarkdownDocument["images"] = [];

  let inCodeBlock = false;
  let codeBlockStart = 0;
  let codeBlockLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        codeBlocks.push({ language: codeBlockLang, line: codeBlockStart + 1, lines: i - codeBlockStart - 1 });
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockLang = line.slice(3).trim() || "text";
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      headings.push({ level: headingMatch[1].length, text: headingMatch[2].trim(), line: i + 1 });
    }

    // Links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(line)) !== null) {
      links.push({ text: linkMatch[1], url: linkMatch[2], line: i + 1 });
    }

    // Images
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(line)) !== null) {
      images.push({ alt: imgMatch[1], url: imgMatch[2], line: i + 1 });
    }
  }

  const stats: MarkdownStats = {
    wordCount: words.length,
    charCount: content.length,
    lineCount: lines.length,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    headingCount: headings.length,
    linkCount: links.length,
    codeBlockCount: codeBlocks.length,
    imageCount: images.length,
    readingTime: Math.max(1, Math.ceil(words.length / 200)),
  };

  return { stats, headings, links, codeBlocks, images };
}

// Generate table of contents from headings
function generateTOC(headings: MarkdownDocument["headings"]): string {
  if (headings.length === 0) return "";
  const minLevel = Math.min(...headings.map((h) => h.level));
  return headings
    .map((h) => {
      const indent = "  ".repeat(h.level - minLevel);
      const anchor = h.text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
      return `${indent}- [${h.text}](#${anchor})`;
    })
    .join("\n");
}

// Insert markdown formatting at cursor position
function insertFormatting(
  content: string,
  cursorStart: number,
  cursorEnd: number,
  type: "bold" | "italic" | "code" | "link" | "image" | "heading" | "list" | "checklist" | "quote" | "hr" | "table" | "codeblock",
): { newContent: string; newCursorStart: number; newCursorEnd: number } {
  const selected = content.slice(cursorStart, cursorEnd);
  let before = content.slice(0, cursorStart);
  let after = content.slice(cursorEnd);
  let inserted = "";
  let newStart = cursorStart;
  let newEnd = cursorEnd;

  switch (type) {
    case "bold":
      inserted = `**${selected || "bold text"}**`;
      newStart = cursorStart + 2;
      newEnd = newStart + (selected || "bold text").length;
      break;
    case "italic":
      inserted = `*${selected || "italic text"}*`;
      newStart = cursorStart + 1;
      newEnd = newStart + (selected || "italic text").length;
      break;
    case "code":
      inserted = `\`${selected || "code"}\``;
      newStart = cursorStart + 1;
      newEnd = newStart + (selected || "code").length;
      break;
    case "link":
      inserted = `[${selected || "link text"}](url)`;
      newStart = cursorStart + 1;
      newEnd = newStart + (selected || "link text").length;
      break;
    case "image":
      inserted = `![${selected || "alt text"}](url)`;
      newStart = cursorStart + 2;
      newEnd = newStart + (selected || "alt text").length;
      break;
    case "heading":
      inserted = `## ${selected || "Heading"}`;
      newStart = cursorStart + 3;
      newEnd = newStart + (selected || "Heading").length;
      break;
    case "list":
      inserted = selected ? selected.split("\n").map((l) => `- ${l}`).join("\n") : "- item";
      newStart = cursorStart + 2;
      newEnd = cursorStart + inserted.length;
      break;
    case "checklist":
      inserted = selected ? selected.split("\n").map((l) => `- [ ] ${l}`).join("\n") : "- [ ] task";
      newStart = cursorStart + 6;
      newEnd = cursorStart + inserted.length;
      break;
    case "quote":
      inserted = selected ? selected.split("\n").map((l) => `> ${l}`).join("\n") : "> quote";
      newStart = cursorStart + 2;
      newEnd = cursorStart + inserted.length;
      break;
    case "hr":
      inserted = "\n---\n";
      newStart = newEnd = cursorStart + inserted.length;
      break;
    case "table":
      inserted = "\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| cell     | cell     | cell     |\n";
      newStart = cursorStart + 3;
      newEnd = cursorStart + 11;
      break;
    case "codeblock":
      inserted = "\n```\n" + (selected || "code here") + "\n```\n";
      newStart = cursorStart + 5;
      newEnd = newStart + (selected || "code here").length;
      break;
  }

  return {
    newContent: before + inserted + after,
    newCursorStart: newStart,
    newCursorEnd: newEnd,
  };
}

// Convert markdown to HTML (basic)
function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/!\[(.+?)\]\((.+?)\)/g, '<img alt="$1" src="$2" />')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/---/g, "<hr />")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");

  return `<p>${html}</p>`;
}

const STORAGE_KEY = "blade-md-documents";

function loadDocs(): MarkdownDocument[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveDocs(docs: MarkdownDocument[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

export function useMarkdownEditor() {
  const [documents, setDocuments] = useState<MarkdownDocument[]>(loadDocs);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [content, setContent] = useState("");

  const analysis = useMemo(() => analyzeMarkdown(content), [content]);

  const activeDoc = documents.find((d) => d.id === activeDocId) || null;

  const createDocument = useCallback((title: string, initialContent = "") => {
    const now = Date.now();
    const { stats, headings, links, codeBlocks, images } = analyzeMarkdown(initialContent);
    const doc: MarkdownDocument = {
      id: crypto.randomUUID(),
      title,
      content: initialContent,
      wordCount: stats.wordCount,
      charCount: stats.charCount,
      lineCount: stats.lineCount,
      headings,
      links,
      codeBlocks,
      images,
      readingTime: stats.readingTime,
      createdAt: now,
      updatedAt: now,
    };
    setDocuments((prev) => {
      const next = [...prev, doc];
      saveDocs(next);
      return next;
    });
    setActiveDocId(doc.id);
    setContent(initialContent);
    return doc.id;
  }, []);

  const saveDocument = useCallback(() => {
    if (!activeDocId) return;
    const { stats, headings, links, codeBlocks, images } = analyzeMarkdown(content);
    setDocuments((prev) => {
      const next = prev.map((d) =>
        d.id === activeDocId
          ? { ...d, content, wordCount: stats.wordCount, charCount: stats.charCount, lineCount: stats.lineCount, headings, links, codeBlocks, images, readingTime: stats.readingTime, updatedAt: Date.now() }
          : d,
      );
      saveDocs(next);
      return next;
    });
  }, [activeDocId, content]);

  const deleteDocument = useCallback((id: string) => {
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDocs(next);
      return next;
    });
    if (activeDocId === id) {
      setActiveDocId(null);
      setContent("");
    }
  }, [activeDocId]);

  const openDocument = useCallback((id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (doc) {
      setActiveDocId(id);
      setContent(doc.content);
    }
  }, [documents]);

  const exportAsHtml = useCallback(() => {
    return `<!DOCTYPE html><html><head><title>${activeDoc?.title || "Document"}</title><style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:2rem;line-height:1.6}code{background:#f0f0f0;padding:0.2rem 0.4rem;border-radius:3px}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto}blockquote{border-left:3px solid #ddd;padding-left:1rem;color:#666}img{max-width:100%}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:0.5rem}</style></head><body>${markdownToHtml(content)}</body></html>`;
  }, [content, activeDoc]);

  return {
    documents,
    activeDoc,
    content,
    setContent,
    analysis,
    createDocument,
    saveDocument,
    deleteDocument,
    openDocument,
    exportAsHtml,
    generateTOC: () => generateTOC(analysis.headings),
    insertFormatting: (start: number, end: number, type: Parameters<typeof insertFormatting>[3]) =>
      insertFormatting(content, start, end, type),
    markdownToHtml: () => markdownToHtml(content),
  };
}
