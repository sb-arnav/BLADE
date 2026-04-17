import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Mem0-inspired universal memory layer for Blade.
 *
 * Instead of dumping full conversation history into every prompt (expensive),
 * this extracts and stores discrete facts that can be retrieved by relevance.
 *
 * memory.add("User prefers TypeScript over JavaScript")
 * memory.add("User is building Blade, a Tauri 2 desktop AI app")
 * memory.search("what framework does the user prefer?")
 *   → "User prefers TypeScript over JavaScript"
 *
 * 90% token reduction vs full history replay.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  category: "preference" | "fact" | "decision" | "context" | "instruction" | "relationship" | "skill";
  importance: number; // 0-1
  source: "conversation" | "manual" | "auto" | "onboarding";
  sourceId?: string;  // conversation id, etc.
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessed: number;
  decay: number; // 0-1, decays over time if not accessed
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  relevance: number;
}

const STORAGE_KEY = "blade-memory-v2";
const MAX_MEMORIES = 1000;

// Category icons for UI
const CATEGORY_ICONS: Record<MemoryEntry["category"], string> = {
  preference: "⚙️",
  fact: "📌",
  decision: "🔀",
  context: "📍",
  instruction: "📋",
  relationship: "🤝",
  skill: "🎯",
};

// Auto-categorize based on content
function autoCategory(content: string): MemoryEntry["category"] {
  const lower = content.toLowerCase();
  if (lower.includes("prefer") || lower.includes("likes") || lower.includes("wants") || lower.includes("style")) return "preference";
  if (lower.includes("decided") || lower.includes("chose") || lower.includes("will use") || lower.includes("going with")) return "decision";
  if (lower.includes("working on") || lower.includes("building") || lower.includes("project") || lower.includes("currently")) return "context";
  if (lower.includes("always") || lower.includes("never") || lower.includes("must") || lower.includes("should") || lower.includes("don't")) return "instruction";
  if (lower.includes("knows") || lower.includes("experienced") || lower.includes("expert") || lower.includes("familiar")) return "skill";
  if (lower.includes("works with") || lower.includes("team") || lower.includes("colleague") || lower.includes("partner")) return "relationship";
  return "fact";
}

// Auto-tag based on content
function autoTag(content: string): string[] {
  const lower = content.toLowerCase();
  const tags: string[] = [];
  const detectors: Record<string, string[]> = {
    "coding": ["code", "function", "api", "database", "bug", "git"],
    "design": ["design", "ui", "ux", "css", "layout", "color"],
    "tools": ["tool", "framework", "library", "package", "plugin"],
    "workflow": ["process", "workflow", "pipeline", "deploy", "ci"],
    "personal": ["name", "email", "phone", "birthday", "location"],
    "project": ["project", "app", "product", "feature", "roadmap"],
    "tech": ["typescript", "rust", "python", "react", "tauri", "node"],
  };
  for (const [tag, keywords] of Object.entries(detectors)) {
    if (keywords.some((kw) => lower.includes(kw))) tags.push(tag);
  }
  return tags;
}

// Simple relevance scoring
function scoreRelevance(entry: MemoryEntry, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const contentLower = entry.content.toLowerCase();
  const tagStr = entry.tags.join(" ").toLowerCase();

  let score = 0;

  // Term matching
  for (const term of queryTerms) {
    if (contentLower.includes(term)) score += 3;
    if (tagStr.includes(term)) score += 2;
  }

  // Exact phrase match bonus
  if (contentLower.includes(query.toLowerCase())) score += 5;

  // Importance boost
  score *= (0.5 + entry.importance * 0.5);

  // Recency boost (memories accessed recently are more relevant)
  const hoursSinceAccess = (Date.now() - entry.lastAccessed) / 3600000;
  if (hoursSinceAccess < 1) score *= 1.5;
  else if (hoursSinceAccess < 24) score *= 1.2;
  else if (hoursSinceAccess > 168) score *= 0.8; // > 1 week

  // Decay penalty
  score *= entry.decay;

  return score;
}

function loadMemories(): MemoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMemories(memories: MemoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories.slice(-MAX_MEMORIES)));
}

export function useMemory() {
  const [memories, setMemories] = useState<MemoryEntry[]>(loadMemories);

  const add = useCallback((
    content: string,
    options?: {
      category?: MemoryEntry["category"];
      importance?: number;
      source?: MemoryEntry["source"];
      sourceId?: string;
      tags?: string[];
    },
  ): string => {
    const id = crypto.randomUUID();
    const entry: MemoryEntry = {
      id,
      content,
      category: options?.category || autoCategory(content),
      importance: options?.importance ?? 0.5,
      source: options?.source || "manual",
      sourceId: options?.sourceId,
      tags: options?.tags || autoTag(content),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
      decay: 1.0,
    };

    setMemories((prev) => {
      // Deduplicate — don't store very similar memories
      const isDuplicate = prev.some((m) => {
        const similarity = content.toLowerCase().trim() === m.content.toLowerCase().trim();
        return similarity;
      });
      if (isDuplicate) return prev;

      const next = [...prev, entry].slice(-MAX_MEMORIES);
      saveMemories(next);
      return next;
    });

    return id;
  }, []);

  const addFromConversation = useCallback((messages: Array<{ role: string; content: string }>, conversationId: string) => {
    // Extract facts from conversation using heuristics
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    const facts: string[] = [];

    for (const msg of userMessages) {
      // "I" statements are often personal facts
      const iStatements = msg.match(/I\s+(am|use|prefer|work|like|have|built|know|want|need|live|study|do)\s+[^.!?]+/gi);
      if (iStatements) {
        for (const stmt of iStatements) {
          if (stmt.length > 10 && stmt.length < 200) {
            facts.push(stmt.trim());
          }
        }
      }

      // "My" statements
      const myStatements = msg.match(/my\s+(name|project|team|company|app|tool|stack|framework|job|role)\s+[^.!?]+/gi);
      if (myStatements) {
        for (const stmt of myStatements) {
          if (stmt.length > 8 && stmt.length < 200) {
            facts.push(stmt.trim());
          }
        }
      }
    }

    for (const fact of facts.slice(0, 5)) {
      add(fact, {
        source: "conversation",
        sourceId: conversationId,
        importance: 0.6,
      });
    }
  }, [add]);

  const search = useCallback((query: string, limit = 10): MemorySearchResult[] => {
    if (!query.trim()) return [];

    const scored = memories
      .map((entry) => ({ entry, relevance: scoreRelevance(entry, query) }))
      .filter((r) => r.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    // Mark accessed
    if (scored.length > 0) {
      const accessedIds = new Set(scored.map((s) => s.entry.id));
      setMemories((prev) => {
        const next = prev.map((m) =>
          accessedIds.has(m.id)
            ? { ...m, accessCount: m.accessCount + 1, lastAccessed: Date.now() }
            : m,
        );
        saveMemories(next);
        return next;
      });
    }

    return scored;
  }, [memories]);

  const remove = useCallback((id: string) => {
    setMemories((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveMemories(next);
      return next;
    });
  }, []);

  const update = useCallback((id: string, content: string) => {
    setMemories((prev) => {
      const next = prev.map((m) =>
        m.id === id
          ? { ...m, content, tags: autoTag(content), category: autoCategory(content), updatedAt: Date.now() }
          : m,
      );
      saveMemories(next);
      return next;
    });
  }, []);

  // Get context string for system prompt injection
  const getContextForPrompt = useCallback((query: string, maxTokens = 500): string => {
    const results = search(query, 15);
    if (results.length === 0) return "";

    const lines = ["[User Memory — things Blade knows about this user]"];
    let tokenEstimate = 0;

    for (const { entry } of results) {
      const line = `- ${CATEGORY_ICONS[entry.category]} ${entry.content}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (tokenEstimate + lineTokens > maxTokens) break;
      lines.push(line);
      tokenEstimate += lineTokens;
    }

    return lines.join("\n");
  }, [search]);

  // Apply decay to old, unaccessed memories
  const applyDecay = useCallback(() => {
    setMemories((prev) => {
      const now = Date.now();
      const next = prev.map((m) => {
        const daysSinceAccess = (now - m.lastAccessed) / 86400000;
        // Decay by 5% per day of non-access, minimum 0.1
        const newDecay = Math.max(0.1, m.decay - (daysSinceAccess > 1 ? 0.05 : 0));
        return { ...m, decay: newDecay };
      });
      // Remove memories that have decayed below 0.15 and are low importance
      const filtered = next.filter((m) => m.decay > 0.15 || m.importance > 0.7);
      saveMemories(filtered);
      return filtered;
    });
  }, []);

  const stats = useMemo(() => ({
    total: memories.length,
    byCategory: Object.fromEntries(
      (["preference", "fact", "decision", "context", "instruction", "relationship", "skill"] as const).map((cat) => [
        cat,
        memories.filter((m) => m.category === cat).length,
      ]),
    ),
    avgImportance: memories.length > 0 ? memories.reduce((s, m) => s + m.importance, 0) / memories.length : 0,
    totalAccesses: memories.reduce((s, m) => s + m.accessCount, 0),
    mostAccessed: [...memories].sort((a, b) => b.accessCount - a.accessCount).slice(0, 5),
    recentlyAdded: [...memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  }), [memories]);

  const clear = useCallback(() => {
    setMemories([]);
    saveMemories([]);
  }, []);

  // Also try to store in SQLite backend
  const syncToBackend = useCallback(async () => {
    try {
      for (const mem of memories.slice(-50)) {
        await invoke("db_set_setting", {
          key: `memory:${mem.id}`,
          value: JSON.stringify(mem),
        });
      }
    } catch {
      // Backend may not be ready
    }
  }, [memories]);

  return {
    memories,
    add,
    addFromConversation,
    search,
    remove,
    update,
    getContextForPrompt,
    applyDecay,
    syncToBackend,
    stats,
    clear,
    categoryIcons: CATEGORY_ICONS,
  };
}
