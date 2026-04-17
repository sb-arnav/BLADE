import { useState, useCallback, useMemo } from "react";

/**
 * Command History — tracks everything the user does in Blade.
 * Every slash command, palette action, route navigation, shortcut.
 * Used for: undo, suggestions, analytics, learning.
 */

export interface CommandExecution {
  id: string;
  command: string;
  category: "navigation" | "action" | "slash" | "shortcut" | "agent" | "tool" | "setting";
  args?: Record<string, string>;
  timestamp: number;
  source: "palette" | "slash" | "keyboard" | "click" | "voice" | "auto";
  result: "success" | "error" | "cancelled";
  durationMs?: number;
}

const STORAGE_KEY = "blade-command-history";
const MAX_ENTRIES = 500;

function loadHistory(): CommandExecution[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(history: CommandExecution[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_ENTRIES)));
}

export function useCommandHistory() {
  const [history, setHistory] = useState<CommandExecution[]>(loadHistory);

  const record = useCallback((
    command: string,
    category: CommandExecution["category"],
    source: CommandExecution["source"],
    result: CommandExecution["result"] = "success",
    args?: Record<string, string>,
    durationMs?: number,
  ) => {
    const entry: CommandExecution = {
      id: crypto.randomUUID(),
      command,
      category,
      args,
      timestamp: Date.now(),
      source,
      result,
      durationMs,
    };

    setHistory((prev) => {
      const next = [...prev, entry].slice(-MAX_ENTRIES);
      saveHistory(next);
      return next;
    });
  }, []);

  const getRecent = useCallback((limit = 20): CommandExecution[] => {
    return [...history].reverse().slice(0, limit);
  }, [history]);

  const getFrequent = useCallback((limit = 10): Array<{ command: string; count: number }> => {
    const counts: Record<string, number> = {};
    for (const entry of history) {
      counts[entry.command] = (counts[entry.command] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([command, count]) => ({ command, count }));
  }, [history]);

  const search = useCallback((query: string): CommandExecution[] => {
    const lower = query.toLowerCase();
    return history.filter((e) => e.command.toLowerCase().includes(lower));
  }, [history]);

  const getByCategory = useCallback((category: CommandExecution["category"]): CommandExecution[] => {
    return history.filter((e) => e.category === category);
  }, [history]);

  const undo = useCallback((): CommandExecution | null => {
    if (history.length === 0) return null;
    return history[history.length - 1];
  }, [history]);

  const stats = useMemo(() => ({
    total: history.length,
    today: history.filter((e) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return e.timestamp >= today.getTime();
    }).length,
    bySource: Object.fromEntries(
      (["palette", "slash", "keyboard", "click", "voice", "auto"] as const).map((s) => [
        s, history.filter((e) => e.source === s).length,
      ])
    ),
    byCategory: Object.fromEntries(
      (["navigation", "action", "slash", "shortcut", "agent", "tool", "setting"] as const).map((c) => [
        c, history.filter((e) => e.category === c).length,
      ])
    ),
    errorRate: history.length > 0
      ? history.filter((e) => e.result === "error").length / history.length
      : 0,
    avgDuration: history.filter((e) => e.durationMs).length > 0
      ? history.filter((e) => e.durationMs).reduce((s, e) => s + (e.durationMs || 0), 0) /
        history.filter((e) => e.durationMs).length
      : 0,
  }), [history]);

  const clear = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return { history, record, getRecent, getFrequent, search, getByCategory, undo, stats, clear };
}
