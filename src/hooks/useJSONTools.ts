import { useState, useCallback, useMemo } from "react";

/**
 * JSON Tools — format, validate, diff, transform JSON data.
 * Essential developer tool built into Blade.
 */

export interface JSONValidation {
  valid: boolean;
  error: string | null;
  errorLine: number | null;
  errorColumn: number | null;
  parsed: unknown | null;
  stats: {
    keys: number;
    depth: number;
    arrays: number;
    objects: number;
    strings: number;
    numbers: number;
    booleans: number;
    nulls: number;
    size: number;
  };
}

export interface JSONDiffResult {
  added: string[];
  removed: string[];
  changed: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  unchanged: number;
}

function countStats(obj: unknown, depth = 0): JSONValidation["stats"] {
  const stats = { keys: 0, depth, arrays: 0, objects: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, size: 0 };

  if (obj === null) { stats.nulls++; return stats; }
  if (typeof obj === "string") { stats.strings++; stats.size += obj.length; return stats; }
  if (typeof obj === "number") { stats.numbers++; return stats; }
  if (typeof obj === "boolean") { stats.booleans++; return stats; }

  if (Array.isArray(obj)) {
    stats.arrays++;
    for (const item of obj) {
      const child = countStats(item, depth + 1);
      stats.keys += child.keys;
      stats.depth = Math.max(stats.depth, child.depth);
      stats.arrays += child.arrays;
      stats.objects += child.objects;
      stats.strings += child.strings;
      stats.numbers += child.numbers;
      stats.booleans += child.booleans;
      stats.nulls += child.nulls;
      stats.size += child.size;
    }
    return stats;
  }

  if (typeof obj === "object") {
    stats.objects++;
    const entries = Object.entries(obj as Record<string, unknown>);
    stats.keys += entries.length;
    for (const [key, value] of entries) {
      stats.size += key.length;
      const child = countStats(value, depth + 1);
      stats.keys += child.keys;
      stats.depth = Math.max(stats.depth, child.depth);
      stats.arrays += child.arrays;
      stats.objects += child.objects;
      stats.strings += child.strings;
      stats.numbers += child.numbers;
      stats.booleans += child.booleans;
      stats.nulls += child.nulls;
      stats.size += child.size;
    }
  }

  return stats;
}

function validateJSON(input: string): JSONValidation {
  if (!input.trim()) {
    return { valid: true, error: null, errorLine: null, errorColumn: null, parsed: null, stats: { keys: 0, depth: 0, arrays: 0, objects: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, size: 0 } };
  }

  try {
    const parsed = JSON.parse(input);
    const stats = countStats(parsed);
    stats.size = input.length;
    return { valid: true, error: null, errorLine: null, errorColumn: null, parsed, stats };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const posMatch = msg.match(/position (\d+)/);
    let errorLine = null;
    let errorColumn = null;

    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const lines = input.slice(0, pos).split("\n");
      errorLine = lines.length;
      errorColumn = lines[lines.length - 1].length + 1;
    }

    return {
      valid: false,
      error: msg,
      errorLine,
      errorColumn,
      parsed: null,
      stats: { keys: 0, depth: 0, arrays: 0, objects: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, size: input.length },
    };
  }
}

function formatJSON(input: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(input), null, indent);
  } catch {
    return input;
  }
}

function minifyJSON(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input));
  } catch {
    return input;
  }
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)])
  );
}

function flattenJSON(obj: unknown, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (obj === null || typeof obj !== "object") {
    result[prefix || "root"] = obj;
    return result;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      Object.assign(result, flattenJSON(item, `${prefix}[${i}]`));
    });
    return result;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(result, flattenJSON(value, newPrefix));
    } else {
      result[newPrefix] = value;
    }
  }

  return result;
}

function diffJSON(a: string, b: string): JSONDiffResult {
  try {
    const flatA = flattenJSON(JSON.parse(a));
    const flatB = flattenJSON(JSON.parse(b));
    const allKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);

    const added: string[] = [];
    const removed: string[] = [];
    const changed: JSONDiffResult["changed"] = [];
    let unchanged = 0;

    for (const key of allKeys) {
      const inA = key in flatA;
      const inB = key in flatB;

      if (inA && !inB) removed.push(key);
      else if (!inA && inB) added.push(key);
      else if (JSON.stringify(flatA[key]) !== JSON.stringify(flatB[key])) {
        changed.push({ path: key, oldValue: flatA[key], newValue: flatB[key] });
      } else {
        unchanged++;
      }
    }

    return { added, removed, changed, unchanged };
  } catch {
    return { added: [], removed: [], changed: [], unchanged: 0 };
  }
}

function jsonToTypeScript(obj: unknown, name = "Root", indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null) return "null";
  if (typeof obj === "string") return "string";
  if (typeof obj === "number") return "number";
  if (typeof obj === "boolean") return "boolean";

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "unknown[]";
    const itemType = jsonToTypeScript(obj[0], name + "Item", indent);
    return `${itemType}[]`;
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "Record<string, unknown>";

    const lines = entries.map(([key, value]) => {
      const type = jsonToTypeScript(value, key.charAt(0).toUpperCase() + key.slice(1), indent + 1);
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
      return `${pad}  ${safeKey}: ${type};`;
    });

    if (indent === 0) {
      return `interface ${name} {\n${lines.join("\n")}\n}`;
    }
    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  return "unknown";
}

const HISTORY_KEY = "blade-json-history";
const MAX_HISTORY = 20;

interface HistoryEntry {
  id: string;
  input: string;
  operation: string;
  timestamp: number;
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(h: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-MAX_HISTORY)));
}

export function useJSONTools() {
  const [input, setInput] = useState("");
  const [compareInput, setCompareInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  const validation = useMemo(() => validateJSON(input), [input]);

  const format = useCallback((indent = 2) => {
    const result = formatJSON(input, indent);
    setInput(result);
    addToHistory("format");
    return result;
  }, [input]);

  const minify = useCallback(() => {
    const result = minifyJSON(input);
    setInput(result);
    addToHistory("minify");
    return result;
  }, [input]);

  const sort = useCallback(() => {
    if (!validation.parsed) return;
    const sorted = sortKeys(validation.parsed);
    setInput(JSON.stringify(sorted, null, 2));
    addToHistory("sort-keys");
  }, [validation.parsed]);

  const flatten = useCallback(() => {
    if (!validation.parsed) return "";
    const flat = flattenJSON(validation.parsed);
    const result = JSON.stringify(flat, null, 2);
    setInput(result);
    addToHistory("flatten");
    return result;
  }, [validation.parsed]);

  const toTypeScript = useCallback((name = "Root") => {
    if (!validation.parsed) return "";
    return jsonToTypeScript(validation.parsed, name);
  }, [validation.parsed]);

  const diff = useMemo(() => {
    if (!input || !compareInput) return null;
    return diffJSON(input, compareInput);
  }, [input, compareInput]);

  const extractPaths = useCallback((): string[] => {
    if (!validation.parsed) return [];
    return Object.keys(flattenJSON(validation.parsed));
  }, [validation.parsed]);

  const queryPath = useCallback((path: string): unknown => {
    if (!validation.parsed) return undefined;
    const flat = flattenJSON(validation.parsed);
    return flat[path];
  }, [validation.parsed]);

  const addToHistory = useCallback((operation: string) => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      input: input.slice(0, 200),
      operation,
      timestamp: Date.now(),
    };
    setHistory((prev) => {
      const next = [...prev, entry].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, [input]);

  return {
    input,
    setInput,
    compareInput,
    setCompareInput,
    validation,
    format,
    minify,
    sort,
    flatten,
    toTypeScript,
    diff,
    extractPaths,
    queryPath,
    history,
  };
}
