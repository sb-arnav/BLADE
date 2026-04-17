import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Clipboard History — like macOS clipboard manager but AI-powered.
 * Keeps history of everything you copy, with AI categorization.
 */

export interface ClipboardEntry {
  id: string;
  content: string;
  type: "text" | "code" | "url" | "email" | "json" | "error" | "command" | "path";
  preview: string;
  timestamp: number;
  pinned: boolean;
  tags: string[];
  usedCount: number;
  source?: string;
}

const STORAGE_KEY = "blade-clipboard-history";
const MAX_ENTRIES = 200;

function detectType(content: string): ClipboardEntry["type"] {
  const trimmed = content.trim();
  if (/^https?:\/\//.test(trimmed)) return "url";
  if (/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(trimmed)) return "email";
  if (/^[A-Z]:\\|^\/[\w/]|^~\//.test(trimmed)) return "path";
  if (/^\$\s|^>\s|^sudo\s|^npm\s|^git\s|^cargo\s|^docker\s/.test(trimmed)) return "command";
  if (/Error:|Exception|Traceback|FAILED|panic/.test(trimmed)) return "error";
  try { JSON.parse(trimmed); return "json"; } catch {}
  if (/function\s|const\s|let\s|var\s|def\s|class\s|import\s|fn\s|pub\s|=>/.test(trimmed)) return "code";
  return "text";
}

function makePreview(content: string): string {
  const firstLine = content.split("\n")[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 80) + "..." : firstLine;
}

function autoTag(content: string, type: ClipboardEntry["type"]): string[] {
  const tags: string[] = [type];
  if (content.length > 500) tags.push("long");
  if (content.includes("```")) tags.push("code-block");
  if (/\d{4}-\d{2}-\d{2}/.test(content)) tags.push("date");
  if (/\$[\d,.]+/.test(content)) tags.push("money");
  return tags;
}

function loadHistory(): ClipboardEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(entries: ClipboardEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

export function useClipboardHistory() {
  const [entries, setEntries] = useState<ClipboardEntry[]>(loadHistory);

  // Listen for clipboard changes from Rust backend
  useEffect(() => {
    let active = true;
    const unlisten = listen<string>("clipboard_changed", (event) => {
      if (!active) return;
      const content = event.payload?.trim();
      if (!content || content.length < 2 || content.length > 50000) return;

      setEntries((prev) => {
        // Skip if same as last entry
        if (prev.length > 0 && prev[prev.length - 1].content === content) return prev;

        const type = detectType(content);
        const entry: ClipboardEntry = {
          id: crypto.randomUUID(),
          content,
          type,
          preview: makePreview(content),
          timestamp: Date.now(),
          pinned: false,
          tags: autoTag(content, type),
          usedCount: 0,
        };

        const next = [...prev, entry].slice(-MAX_ENTRIES);
        saveHistory(next);
        return next;
      });
    });

    return () => {
      active = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  const paste = useCallback(async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    await navigator.clipboard.writeText(entry.content);
    setEntries((prev) => {
      const next = prev.map((e) => e.id === id ? { ...e, usedCount: e.usedCount + 1 } : e);
      saveHistory(next);
      return next;
    });
  }, [entries]);

  const pin = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.map((e) => e.id === id ? { ...e, pinned: !e.pinned } : e);
      saveHistory(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries((prev) => {
      const pinned = prev.filter((e) => e.pinned);
      saveHistory(pinned);
      return pinned;
    });
  }, []);

  const search = useCallback((query: string): ClipboardEntry[] => {
    const lower = query.toLowerCase();
    return entries.filter((e) =>
      e.content.toLowerCase().includes(lower) ||
      e.tags.some((t) => t.includes(lower)) ||
      e.preview.toLowerCase().includes(lower)
    );
  }, [entries]);

  const getByType = useCallback((type: ClipboardEntry["type"]): ClipboardEntry[] => {
    return entries.filter((e) => e.type === type);
  }, [entries]);

  // Sort: pinned first, then newest
  const sorted = [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.timestamp - a.timestamp;
  });

  const stats = {
    total: entries.length,
    pinned: entries.filter((e) => e.pinned).length,
    byType: Object.fromEntries(
      (["text", "code", "url", "email", "json", "error", "command", "path"] as const).map((t) => [
        t, entries.filter((e) => e.type === t).length,
      ])
    ),
  };

  return { entries: sorted, paste, pin, remove, clear, search, getByType, stats };
}
