/**
 * Markdown processing library for Blade.
 * Uses 'marked' for parsing + DOMPurify for sanitization.
 * Handles: rendering, TOC extraction, link collection, code block extraction,
 * front matter parsing, and markdown-to-plain-text conversion.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked for Blade
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Render markdown to sanitized HTML
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
      "ul", "ol", "li", "blockquote", "pre", "code",
      "strong", "em", "del", "a", "img", "table", "thead",
      "tbody", "tr", "th", "td", "input", "span", "div",
      "sup", "sub", "details", "summary",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "id",
      "target", "rel", "type", "checked", "disabled",
      "width", "height", "align", "colspan", "rowspan",
    ],
  });
}

/**
 * Extract table of contents from markdown
 */
export interface TOCEntry {
  level: number;
  text: string;
  slug: string;
  children: TOCEntry[];
}

export function extractTOC(md: string): TOCEntry[] {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const entries: Array<{ level: number; text: string; slug: string }> = [];
  let match;

  while ((match = headingRegex.exec(md)) !== null) {
    entries.push({
      level: match[1].length,
      text: match[2].replace(/[*_`\[\]]/g, "").trim(),
      slug: match[2]
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-"),
    });
  }

  // Build tree
  const root: TOCEntry[] = [];
  const stack: TOCEntry[] = [];

  for (const entry of entries) {
    const node: TOCEntry = { ...entry, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return root;
}

/**
 * Extract all links from markdown
 */
export interface ExtractedLink {
  text: string;
  url: string;
  isImage: boolean;
  line: number;
}

export function extractLinks(md: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Images
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = imgRegex.exec(lines[i])) !== null) {
      links.push({ text: match[1], url: match[2], isImage: true, line: i + 1 });
    }

    // Links
    const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(lines[i])) !== null) {
      links.push({ text: match[1], url: match[2], isImage: false, line: i + 1 });
    }

    // Bare URLs
    const urlRegex = /(?<!\()https?:\/\/[^\s<>"{}|\\^`\[\])]+/g;
    while ((match = urlRegex.exec(lines[i])) !== null) {
      // Skip if already captured as part of a markdown link
      const alreadyCaptured = links.some((l) => l.url === match![0] && l.line === i + 1);
      if (!alreadyCaptured) {
        links.push({ text: match[0], url: match[0], isImage: false, line: i + 1 });
      }
    }
  }

  return links;
}

/**
 * Extract all code blocks from markdown
 */
export interface ExtractedCodeBlock {
  language: string;
  code: string;
  startLine: number;
  endLine: number;
}

export function extractCodeBlocks(md: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const lines = md.split("\n");
  let inBlock = false;
  let currentLang = "";
  let currentCode: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) {
      if (inBlock) {
        blocks.push({
          language: currentLang || "text",
          code: currentCode.join("\n"),
          startLine,
          endLine: i + 1,
        });
        inBlock = false;
        currentCode = [];
      } else {
        inBlock = true;
        currentLang = lines[i].slice(3).trim();
        startLine = i + 1;
      }
    } else if (inBlock) {
      currentCode.push(lines[i]);
    }
  }

  return blocks;
}

/**
 * Parse front matter (YAML-like key: value at top of document)
 */
export function parseFrontMatter(md: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = md.match(fmRegex);

  if (!match) return { metadata: {}, content: md };

  const metadata: Record<string, string> = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      metadata[key] = value;
    }
  }

  return { metadata, content: md.slice(match[0].length) };
}

/**
 * Convert markdown to plain text (strip all formatting)
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/>\s+/gm, "")
    .replace(/[-*+]\s+/gm, "")
    .replace(/\d+\.\s+/gm, "")
    .replace(/---+/g, "")
    .replace(/\|[^\n]+\|/g, "")
    .replace(/-{3,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Count markdown statistics
 */
export interface MarkdownStats {
  words: number;
  characters: number;
  lines: number;
  paragraphs: number;
  sentences: number;
  headings: number;
  links: number;
  images: number;
  codeBlocks: number;
  lists: number;
  blockquotes: number;
  tables: number;
  readingTimeMinutes: number;
}

export function analyzeMarkdown(md: string): MarkdownStats {
  const plainText = markdownToPlainText(md);
  const words = plainText.split(/\s+/).filter(Boolean).length;

  return {
    words,
    characters: md.length,
    lines: md.split("\n").length,
    paragraphs: md.split(/\n\n+/).filter((p) => p.trim()).length,
    sentences: plainText.split(/[.!?]+/).filter((s) => s.trim()).length,
    headings: (md.match(/^#{1,6}\s/gm) || []).length,
    links: (md.match(/\[([^\]]+)\]\([^)]+\)/g) || []).length,
    images: (md.match(/!\[([^\]]*)\]\([^)]+\)/g) || []).length,
    codeBlocks: (md.match(/```/g) || []).length / 2,
    lists: (md.match(/^[-*+]\s|^\d+\.\s/gm) || []).length,
    blockquotes: (md.match(/^>\s/gm) || []).length,
    tables: (md.match(/^\|.+\|$/gm) || []).length > 0 ? 1 : 0,
    readingTimeMinutes: Math.max(1, Math.ceil(words / 200)),
  };
}

/**
 * Generate a summary of markdown content (first N sentences)
 */
export function summarizeMarkdown(md: string, maxSentences = 3): string {
  const plain = markdownToPlainText(md);
  const sentences = plain.match(/[^.!?]*[.!?]+/g) || [plain];
  return sentences.slice(0, maxSentences).join(" ").trim();
}

/**
 * Highlight search terms in markdown HTML output
 */
export function highlightSearchTerms(html: string, terms: string[]): string {
  let result = html;
  for (const term of terms) {
    if (!term.trim()) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    result = result.replace(regex, '<mark class="bg-blade-accent/20 text-blade-accent">$1</mark>');
  }
  return result;
}

/**
 * Convert markdown table to structured data
 */
export function parseMarkdownTable(md: string): {
  headers: string[];
  rows: string[][];
} | null {
  const lines = md.trim().split("\n").filter((l) => l.includes("|"));
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line.split("|").map((cell) => cell.trim()).filter((cell) => cell && !cell.match(/^-+$/));

  const headers = parseRow(lines[0]);
  // Skip separator line (lines[1])
  const rows = lines.slice(2).map(parseRow).filter((r) => r.length > 0);

  return { headers, rows };
}

/**
 * Create a markdown table from data
 */
export function createMarkdownTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map((r) => r[i] || "")];
    return Math.max(...colValues.map((v) => v.length));
  });

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const headerLine = "| " + headers.map((h, i) => pad(h, widths[i])).join(" | ") + " |";
  const separator = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
  const dataLines = rows.map(
    (row) => "| " + row.map((cell, i) => pad(cell || "", widths[i])).join(" | ") + " |",
  );

  return [headerLine, separator, ...dataLines].join("\n");
}
