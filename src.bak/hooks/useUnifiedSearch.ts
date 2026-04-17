import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  type:
    | "message"
    | "conversation"
    | "knowledge"
    | "file"
    | "snippet"
    | "template"
    | "command"
    | "setting"
    | "agent"
    | "workflow";
  title: string;
  preview: string;
  relevance: number;
  timestamp?: number;
  metadata: Record<string, string>;
  action: () => void;
}

export interface SearchCategory {
  type: SearchResult["type"];
  label: string;
  icon: string;
  count: number;
}

interface UseUnifiedSearchOptions {
  commands?: { id: string; label: string; shortcut?: string; action: () => void }[];
  onNavigate?: (route: string) => void;
  onSendMessage?: (message: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const RECENT_KEY = "blade-recent-searches";
const MAX_RECENT = 10;
const DEBOUNCE_MS = 200;

const SETTING_ENTRIES = [
  { id: "setting-provider", label: "Provider", section: "provider", keywords: "api key model gemini groq openai anthropic ollama" },
  { id: "setting-memory", label: "Memory", section: "memory", keywords: "persona context system prompt" },
  { id: "setting-mcp", label: "MCP Servers", section: "mcp", keywords: "tool server protocol plugin" },
  { id: "setting-about", label: "About Blade", section: "about", keywords: "version info" },
  { id: "setting-theme", label: "Theme", section: "theme", keywords: "dark light accent color appearance" },
  { id: "setting-notifications", label: "Notifications", section: "notifications", keywords: "sound alert desktop" },
  { id: "setting-shortcuts", label: "Keyboard Shortcuts", section: "shortcuts", keywords: "hotkey keybinding bind" },
  { id: "setting-export", label: "Export Data", section: "export", keywords: "backup download json" },
];

const CATEGORY_META: Record<SearchResult["type"], { label: string; icon: string }> = {
  message: { label: "Messages", icon: "chat" },
  conversation: { label: "Conversations", icon: "folder" },
  knowledge: { label: "Knowledge", icon: "book" },
  file: { label: "Files", icon: "file" },
  snippet: { label: "Snippets", icon: "code" },
  template: { label: "Templates", icon: "template" },
  command: { label: "Commands", icon: "terminal" },
  setting: { label: "Settings", icon: "gear" },
  agent: { label: "Agents", icon: "robot" },
  workflow: { label: "Workflows", icon: "workflow" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT);
    }
  } catch {
    // ignore corrupt data
  }
  return [];
}

function saveRecentSearches(searches: string[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(searches.slice(0, MAX_RECENT)));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreMatch(text: string, query: string): number {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!lower.includes(q)) return 0;

  let score = 10;
  // Exact match bonus
  if (lower === q) score += 100;
  // Starts-with bonus
  if (lower.startsWith(q)) score += 50;
  // Word boundary bonus
  const wordBoundaryRe = new RegExp(`\\b${escapeRegex(q)}`, "i");
  if (wordBoundaryRe.test(text)) score += 30;
  // Shorter texts rank higher (more specific)
  score += Math.max(0, 20 - Math.floor(text.length / 20));

  return score;
}

function truncatePreview(text: string, query: string, maxLen = 120): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let preview = text.slice(start, end).replace(/\n/g, " ").trim();
  if (start > 0) preview = "..." + preview;
  if (end < text.length) preview = preview + "...";
  return preview;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useUnifiedSearch(options: UseUnifiedSearchOptions = {}) {
  const { commands = [], onNavigate, onSendMessage } = options;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SearchResult["type"] | "all">("all");
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0); // simple generation counter for stale-result prevention

  // ── Derived categories ────────────────────────────────────────────────────

  const categories = useMemo((): SearchCategory[] => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.type] = (counts[r.type] ?? 0) + 1;
    }
    return Object.entries(CATEGORY_META)
      .filter(([type]) => (counts[type] ?? 0) > 0)
      .map(([type, meta]) => ({
        type: type as SearchResult["type"],
        label: meta.label,
        icon: meta.icon,
        count: counts[type] ?? 0,
      }));
  }, [results]);

  // ── Filtered results by selected category ─────────────────────────────────

  const filteredResults = useMemo(() => {
    if (selectedCategory === "all") return results;
    return results.filter((r) => r.type === selectedCategory);
  }, [results, selectedCategory]);

  // ── Recent searches management ────────────────────────────────────────────

  const addRecentSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, MAX_RECENT);
      saveRecentSearches(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    saveRecentSearches([]);
  }, []);

  // ── Search: instant sources (commands, settings, templates, snippets) ─────

  const searchInstantSources = useCallback(
    (q: string): SearchResult[] => {
      const instant: SearchResult[] = [];
      const lower = q.toLowerCase();

      // Commands
      for (const cmd of commands) {
        const score = scoreMatch(cmd.label, q);
        if (score > 0) {
          instant.push({
            id: `cmd-${cmd.id}`,
            type: "command",
            title: cmd.label,
            preview: cmd.shortcut ? `Shortcut: ${cmd.shortcut}` : "Command",
            relevance: score + 5, // small boost for commands (actionable)
            metadata: cmd.shortcut ? { shortcut: cmd.shortcut } : {},
            action: cmd.action,
          });
        }
      }

      // Settings
      for (const setting of SETTING_ENTRIES) {
        const haystack = `${setting.label} ${setting.keywords}`.toLowerCase();
        if (haystack.includes(lower)) {
          const score = scoreMatch(setting.label, q) || 15;
          instant.push({
            id: setting.id,
            type: "setting",
            title: setting.label,
            preview: `Settings > ${setting.label}`,
            relevance: score,
            metadata: { section: setting.section },
            action: () => onNavigate?.(`/settings/${setting.section}`),
          });
        }
      }

      // Templates from localStorage
      try {
        const raw = localStorage.getItem("blade-templates");
        const builtinTemplates = [
          { id: "builtin-code-review", name: "Code Review", content: "Review this code for bugs, performance, and best practices", category: "coding" },
          { id: "builtin-debug-error", name: "Debug Error", content: "Debug this error. Explain the cause and suggest a fix", category: "coding" },
          { id: "builtin-write-tests", name: "Write Tests", content: "Write comprehensive tests for code", category: "coding" },
          { id: "builtin-refactor", name: "Refactor", content: "Refactor this code to be cleaner and more maintainable", category: "coding" },
          { id: "builtin-proofread", name: "Proofread", content: "Proofread and improve this text. Fix grammar, clarity, and tone", category: "writing" },
          { id: "builtin-summarize", name: "Summarize", content: "Summarize the key points", category: "writing" },
          { id: "builtin-email-draft", name: "Email Draft", content: "Write a professional email", category: "writing" },
          { id: "builtin-explain-concept", name: "Explain Concept", content: "Explain concept in simple terms with examples", category: "analysis" },
          { id: "builtin-compare-options", name: "Compare Options", content: "Compare options and recommend the best choice", category: "analysis" },
          { id: "builtin-pros-and-cons", name: "Pros and Cons", content: "List the pros and cons", category: "analysis" },
          { id: "builtin-translate", name: "Translate", content: "Translate text to another language", category: "custom" },
        ];
        const userTemplates = raw ? JSON.parse(raw) : [];
        const allTemplates = [...builtinTemplates, ...(Array.isArray(userTemplates) ? userTemplates : [])];

        for (const tpl of allTemplates) {
          const haystack = `${tpl.name} ${tpl.content ?? ""} ${tpl.category ?? ""}`.toLowerCase();
          if (haystack.includes(lower)) {
            instant.push({
              id: `tpl-${tpl.id}`,
              type: "template",
              title: tpl.name,
              preview: truncatePreview(tpl.content ?? tpl.name, q, 100),
              relevance: scoreMatch(tpl.name, q) || 10,
              metadata: { category: tpl.category ?? "custom" },
              action: () => onNavigate?.(`/templates/${tpl.id}`),
            });
          }
        }
      } catch {
        // ignore
      }

      // Snippets from localStorage
      try {
        const raw = localStorage.getItem("blade-snippets");
        if (raw) {
          const snippets = JSON.parse(raw);
          if (Array.isArray(snippets)) {
            for (const snp of snippets) {
              const haystack = `${snp.title} ${snp.code ?? ""} ${snp.description ?? ""} ${(snp.tags ?? []).join(" ")}`.toLowerCase();
              if (haystack.includes(lower)) {
                instant.push({
                  id: `snp-${snp.id}`,
                  type: "snippet",
                  title: snp.title,
                  preview: truncatePreview(snp.code ?? snp.title, q, 100),
                  relevance: scoreMatch(snp.title, q) || 10,
                  timestamp: snp.createdAt,
                  metadata: { language: snp.language ?? "text" },
                  action: () => onNavigate?.(`/snippets/${snp.id}`),
                });
              }
            }
          }
        }
      } catch {
        // ignore
      }

      return instant;
    },
    [commands, onNavigate],
  );

  // ── Search: async / DB sources ────────────────────────────────────────────

  const searchAsyncSources = useCallback(
    async (q: string, generation: number): Promise<SearchResult[]> => {
      const async_results: SearchResult[] = [];

      // Run all DB searches in parallel
      const [messagesResult, knowledgeResult, filesResult] = await Promise.allSettled([
        // Messages via Tauri
        invoke("db_search_messages", { query: q }).catch(() => []),
        // Knowledge base via Tauri
        invoke("db_search_knowledge", { query: q }).catch(() => []),
        // File listing via Tauri
        invoke("file_list", { query: q }).catch(() => []),
      ]);

      // Bail if a newer search superseded this one
      if (abortRef.current !== generation) return [];

      // Process messages
      if (messagesResult.status === "fulfilled" && Array.isArray(messagesResult.value)) {
        const messages = messagesResult.value as Array<{
          id?: string;
          content?: string;
          role?: string;
          timestamp?: number;
          conversation_id?: string;
          conversation_title?: string;
        }>;
        for (const msg of messages.slice(0, 20)) {
          const content = msg.content ?? "";
          const score = scoreMatch(content, q);
          async_results.push({
            id: `msg-${msg.id ?? crypto.randomUUID()}`,
            type: "message",
            title: msg.conversation_title ?? (msg.role === "user" ? "You" : "Assistant"),
            preview: truncatePreview(content, q),
            relevance: score || 15,
            timestamp: msg.timestamp,
            metadata: {
              role: msg.role ?? "user",
              ...(msg.conversation_id ? { conversationId: msg.conversation_id } : {}),
            },
            action: () => onNavigate?.(`/chat/${msg.conversation_id ?? ""}`),
          });
        }
      }

      // Process knowledge entries
      if (knowledgeResult.status === "fulfilled" && Array.isArray(knowledgeResult.value)) {
        const entries = knowledgeResult.value as Array<{
          id?: string;
          title?: string;
          content?: string;
          tags?: string[];
          updatedAt?: number;
        }>;
        for (const entry of entries.slice(0, 15)) {
          const title = entry.title ?? "Untitled";
          const content = entry.content ?? "";
          async_results.push({
            id: `kb-${entry.id ?? crypto.randomUUID()}`,
            type: "knowledge",
            title,
            preview: truncatePreview(content, q),
            relevance: scoreMatch(title, q) + scoreMatch(content, q) * 0.5,
            timestamp: entry.updatedAt,
            metadata: { tags: (entry.tags ?? []).join(", ") },
            action: () => onNavigate?.(`/knowledge/${entry.id ?? ""}`),
          });
        }
      }

      // Process files
      if (filesResult.status === "fulfilled" && Array.isArray(filesResult.value)) {
        const files = filesResult.value as Array<{
          name?: string;
          path?: string;
          size?: number;
          modified?: number;
        }>;
        for (const file of files.slice(0, 15)) {
          const name = file.name ?? file.path ?? "Unknown file";
          const score = scoreMatch(name, q);
          if (score > 0 || name.toLowerCase().includes(q.toLowerCase())) {
            async_results.push({
              id: `file-${file.path ?? name}`,
              type: "file",
              title: name,
              preview: file.path ?? name,
              relevance: score || 10,
              timestamp: file.modified,
              metadata: {
                path: file.path ?? "",
                ...(file.size != null ? { size: String(file.size) } : {}),
              },
              action: () => onNavigate?.(`/files/${encodeURIComponent(file.path ?? name)}`),
            });
          }
        }
      }

      // Also search localStorage knowledge as fallback
      try {
        const raw = localStorage.getItem("blade-knowledge");
        if (raw) {
          const entries = JSON.parse(raw);
          if (Array.isArray(entries)) {
            const existingIds = new Set(async_results.filter((r) => r.type === "knowledge").map((r) => r.id));
            for (const entry of entries) {
              const id = `kb-${entry.id}`;
              if (existingIds.has(id)) continue;
              const haystack = `${entry.title ?? ""} ${entry.content ?? ""} ${(entry.tags ?? []).join(" ")}`.toLowerCase();
              if (haystack.includes(q.toLowerCase())) {
                async_results.push({
                  id,
                  type: "knowledge",
                  title: entry.title ?? "Untitled",
                  preview: truncatePreview(entry.content ?? "", q),
                  relevance: scoreMatch(entry.title ?? "", q) || 12,
                  timestamp: entry.updatedAt,
                  metadata: { tags: (entry.tags ?? []).join(", ") },
                  action: () => onNavigate?.(`/knowledge/${entry.id}`),
                });
              }
            }
          }
        }
      } catch {
        // ignore
      }

      return async_results;
    },
    [onNavigate],
  );

  // ── Main search dispatcher ────────────────────────────────────────────────

  const executeSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      // AI search mode: prefix with "?" sends to chat instead
      if (trimmed.startsWith("?")) {
        const aiQuery = trimmed.slice(1).trim();
        if (aiQuery && onSendMessage) {
          onSendMessage(aiQuery);
        }
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      // Instant results first
      const instant = searchInstantSources(trimmed);
      setResults(instant.sort((a, b) => b.relevance - a.relevance));

      // Then async results
      const generation = ++abortRef.current;
      searchAsyncSources(trimmed, generation).then((asyncResults) => {
        if (abortRef.current !== generation) return;

        const merged = [...instant, ...asyncResults];
        // Deduplicate by id
        const seen = new Set<string>();
        const deduped = merged.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        // Sort by relevance
        deduped.sort((a, b) => b.relevance - a.relevance);

        setResults(deduped);
        setIsSearching(false);
      });
    },
    [searchInstantSources, searchAsyncSources, onSendMessage],
  );

  // ── Debounced query effect ────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    // Instant sources fire immediately
    const instant = searchInstantSources(trimmed);
    if (instant.length > 0) {
      setResults(instant.sort((a, b) => b.relevance - a.relevance));
    }

    // Debounce async/DB sources
    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      executeSearch(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, searchInstantSources, executeSearch]);

  // ── Commit search to recents on explicit action ───────────────────────────

  const commitSearch = useCallback(
    (q?: string) => {
      addRecentSearch(q ?? query);
    },
    [query, addRecentSearch],
  );

  // Reset category when query changes
  useEffect(() => {
    setSelectedCategory("all");
  }, [query]);

  return {
    query,
    setQuery,
    results: filteredResults,
    allResults: results,
    categories,
    isSearching,
    selectedCategory,
    setSelectedCategory,
    recentSearches,
    clearRecent,
    commitSearch,
    isAiMode: query.trim().startsWith("?"),
  };
}
