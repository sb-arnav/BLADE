import { useState, useCallback, useMemo } from "react";
import { Message } from "../types";

export interface SearchResult {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  matchStart: number;
  matchEnd: number;
  contextBefore: string;
  contextAfter: string;
  timestamp: number;
  conversationId?: string;
  conversationTitle?: string;
}

export interface MessageSearchState {
  query: string;
  results: SearchResult[];
  currentIndex: number;
  isSearching: boolean;
  totalMatches: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatches(
  messages: Message[],
  query: string,
  conversationId?: string,
  conversationTitle?: string,
): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const pattern = new RegExp(escapeRegex(query), "gi");

  for (const msg of messages) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(msg.content)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const contextStart = Math.max(0, start - 40);
      const contextEnd = Math.min(msg.content.length, end + 40);

      results.push({
        messageId: msg.id,
        role: msg.role,
        content: msg.content,
        matchStart: start,
        matchEnd: end,
        contextBefore: (contextStart > 0 ? "..." : "") + msg.content.slice(contextStart, start),
        contextAfter: msg.content.slice(end, contextEnd) + (contextEnd < msg.content.length ? "..." : ""),
        timestamp: msg.timestamp,
        conversationId,
        conversationTitle,
      });
    }
  }

  return results;
}

export function useMessageSearch(messages: Message[], conversationId?: string, conversationTitle?: string) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const results = useMemo(
    () => findMatches(messages, query, conversationId, conversationTitle),
    [messages, query, conversationId, conversationTitle],
  );

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setCurrentIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setCurrentIndex(0);
  }, []);

  const search = useCallback((q: string) => {
    setQuery(q);
    setCurrentIndex(0);
  }, []);

  const nextResult = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % Math.max(results.length, 1));
  }, [results.length]);

  const prevResult = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + results.length) % Math.max(results.length, 1));
  }, [results.length]);

  const currentResult = results.length > 0 ? results[currentIndex] : null;

  return {
    isOpen,
    open,
    close,
    query,
    search,
    results,
    currentIndex,
    currentResult,
    nextResult,
    prevResult,
    totalMatches: results.length,
  };
}
