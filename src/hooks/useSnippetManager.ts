import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface CodeSnippet {
  id: string;
  title: string;
  code: string;
  language: string;
  description: string;
  tags: string[];
  source: "conversation" | "manual" | "template";
  sourceConversationId?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  isFavorite: boolean;
}

export interface SnippetStats {
  total: number;
  byLanguage: Record<string, number>;
  mostUsed: CodeSnippet[];
  recentlyAdded: CodeSnippet[];
  favoriteCount: number;
  totalTags: number;
}

export type ExportFormat = "file" | "clipboard" | "gist";
export type SortMode = "newest" | "most-used" | "alphabetical";

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-snippets";

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  "c#": "csharp",
  kt: "kotlin",
  tf: "hcl",
  dockerfile: "docker",
};

function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

/** Auto-detect language from code heuristics when no language tag present. */
function detectLanguage(code: string): string {
  const trimmed = code.trim();
  if (/^import\s+React|^import\s+{.*}\s+from\s+['"]react/.test(trimmed)) return "typescript";
  if (/^import\s+\w+\s+from\s+['"]|^export\s+(default\s+)?function/.test(trimmed)) return "javascript";
  if (/^(def |class |import |from \w+ import|print\()/.test(trimmed)) return "python";
  if (/^(fn |let mut |use std::|pub (fn|struct|enum|mod))/.test(trimmed)) return "rust";
  if (/^(func |package |import\s+\()/.test(trimmed)) return "go";
  if (/^(public class |System\.out|import java\.)/.test(trimmed)) return "java";
  if (/^(<\?php|namespace\s|use\s+\w+\\)/.test(trimmed)) return "php";
  if (/^(SELECT |INSERT |UPDATE |CREATE TABLE|ALTER TABLE)/i.test(trimmed)) return "sql";
  if (/^<!DOCTYPE|^<html|^<div/.test(trimmed)) return "html";
  if (/^\.\w+\s*\{|^#\w+\s*\{|^@media|^:root/.test(trimmed)) return "css";
  if (/^#!\s*\/bin\/(bash|sh|zsh)/.test(trimmed)) return "bash";
  if (/^\$\s|^echo\s|^export\s|^alias\s/.test(trimmed)) return "bash";
  if (/^apiVersion:|^kind:\s/.test(trimmed)) return "yaml";
  if (/^\{[\s\n]*"/.test(trimmed)) return "json";
  return "text";
}

function generateId(): string {
  return `snp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Fenced code block extraction ───────────────────────────────────────

interface ExtractedBlock {
  language: string;
  code: string;
  context: string; // text immediately before the block (for title hint)
}

function extractCodeBlocks(messages: { role: string; content: string }[]): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;

  for (const msg of messages) {
    if (!msg.content) continue;
    let match: RegExpExecArray | null;
    while ((match = fenceRe.exec(msg.content)) !== null) {
      const rawLang = match[1] || "";
      const code = match[2].trimEnd();
      if (code.length < 4) continue; // skip trivially short blocks

      // grab the line immediately before the fence for title hint
      const before = msg.content.slice(0, match.index);
      const lastLine = before.trim().split("\n").pop() ?? "";

      blocks.push({
        language: rawLang ? normalizeLang(rawLang) : detectLanguage(code),
        code,
        context: lastLine.replace(/[*_#`>]/g, "").trim(),
      });
    }
  }
  return blocks;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useSnippetManager() {
  const [snippets, setSnippets] = useState<CodeSnippet[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Persist on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  }, [snippets]);

  // ── CRUD ─────────────────────────────────────────────────────────────

  const addSnippet = useCallback(
    (partial: Pick<CodeSnippet, "title" | "code" | "language"> & Partial<CodeSnippet>) => {
      const now = Date.now();
      const snippet: CodeSnippet = {
        id: generateId(),
        description: "",
        tags: [],
        source: "manual",
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
        isFavorite: false,
        ...partial,
        language: normalizeLang(partial.language),
      };
      setSnippets((prev) => [snippet, ...prev]);
      return snippet;
    },
    [],
  );

  const updateSnippet = useCallback((id: string, changes: Partial<CodeSnippet>) => {
    setSnippets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...changes, updatedAt: Date.now() } : s)),
    );
  }, []);

  const deleteSnippet = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const incrementUsage = useCallback((id: string) => {
    setSnippets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, usageCount: s.usageCount + 1 } : s)),
    );
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────

  const searchSnippets = useCallback(
    (query: string): CodeSnippet[] => {
      const q = query.toLowerCase();
      return snippets.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    },
    [snippets],
  );

  const getByLanguage = useCallback(
    (lang: string) => snippets.filter((s) => s.language === normalizeLang(lang)),
    [snippets],
  );

  const getByTag = useCallback(
    (tag: string) => snippets.filter((s) => s.tags.includes(tag)),
    [snippets],
  );

  const favorites = useMemo(() => snippets.filter((s) => s.isFavorite), [snippets]);

  const toggleFavorite = useCallback((id: string) => {
    setSnippets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isFavorite: !s.isFavorite } : s)),
    );
  }, []);

  // ── Import from conversation ─────────────────────────────────────────

  const importFromConversation = useCallback(
    (
      messages: { role: string; content: string }[],
      conversationId?: string,
    ): CodeSnippet[] => {
      const blocks = extractCodeBlocks(messages);
      const created: CodeSnippet[] = [];

      for (const block of blocks) {
        const title =
          block.context.length > 3 && block.context.length < 80
            ? block.context
            : `${block.language} snippet`;
        const snippet = addSnippet({
          title,
          code: block.code,
          language: block.language,
          source: "conversation",
          sourceConversationId: conversationId,
        });
        created.push(snippet);
      }
      return created;
    },
    [addSnippet],
  );

  // ── Export ───────────────────────────────────────────────────────────

  const exportSnippet = useCallback(
    async (id: string, format: ExportFormat) => {
      const snippet = snippets.find((s) => s.id === id);
      if (!snippet) return;

      if (format === "clipboard") {
        await navigator.clipboard.writeText(snippet.code);
      } else if (format === "file") {
        const extMap: Record<string, string> = {
          javascript: "js", typescript: "ts", python: "py", rust: "rs",
          go: "go", java: "java", ruby: "rb", php: "php", bash: "sh",
          html: "html", css: "css", json: "json", yaml: "yml", sql: "sql",
          markdown: "md", text: "txt",
        };
        const ext = extMap[snippet.language] ?? "txt";
        const blob = new Blob([snippet.code], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${snippet.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
      // "gist" — placeholder for future GitHub Gist integration
    },
    [snippets],
  );

  // ── Stats ────────────────────────────────────────────────────────────

  const stats: SnippetStats = useMemo(() => {
    const byLanguage: Record<string, number> = {};
    const allTags = new Set<string>();

    for (const s of snippets) {
      byLanguage[s.language] = (byLanguage[s.language] ?? 0) + 1;
      s.tags.forEach((t) => allTags.add(t));
    }

    const sorted = [...snippets];
    return {
      total: snippets.length,
      byLanguage,
      mostUsed: sorted.sort((a, b) => b.usageCount - a.usageCount).slice(0, 5),
      recentlyAdded: sorted.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
      favoriteCount: snippets.filter((s) => s.isFavorite).length,
      totalTags: allTags.size,
    };
  }, [snippets]);

  return {
    snippets,
    addSnippet,
    updateSnippet,
    deleteSnippet,
    incrementUsage,
    searchSnippets,
    getByLanguage,
    getByTag,
    favorites,
    toggleFavorite,
    importFromConversation,
    exportSnippet,
    stats,
    extractCodeBlocks,
  };
}
