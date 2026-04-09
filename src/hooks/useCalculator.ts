import { useState, useCallback } from "react";

/**
 * Calculator — programmer's calculator with history and AI.
 * Supports: decimal, hex, binary, octal. Bitwise operations.
 */

export interface CalcHistory {
  id: string;
  expression: string;
  result: string;
  base: "dec" | "hex" | "bin" | "oct";
  timestamp: number;
}

export interface CalcState {
  display: string;
  expression: string;
  result: string | null;
  base: "dec" | "hex" | "bin" | "oct";
  memory: number;
  history: CalcHistory[];
  error: string | null;
  angleMode: "deg" | "rad";
}

// Safe math evaluation
function evaluate(expr: string): number {
  // Replace math functions
  let processed = expr
    .replace(/π|pi/gi, String(Math.PI))
    .replace(/e(?![xp])/gi, String(Math.E))
    .replace(/sqrt\(([^)]+)\)/gi, (_, n) => String(Math.sqrt(parseFloat(n))))
    .replace(/abs\(([^)]+)\)/gi, (_, n) => String(Math.abs(parseFloat(n))))
    .replace(/log\(([^)]+)\)/gi, (_, n) => String(Math.log10(parseFloat(n))))
    .replace(/ln\(([^)]+)\)/gi, (_, n) => String(Math.log(parseFloat(n))))
    .replace(/sin\(([^)]+)\)/gi, (_, n) => String(Math.sin(parseFloat(n))))
    .replace(/cos\(([^)]+)\)/gi, (_, n) => String(Math.cos(parseFloat(n))))
    .replace(/tan\(([^)]+)\)/gi, (_, n) => String(Math.tan(parseFloat(n))))
    .replace(/pow\(([^,]+),([^)]+)\)/gi, (_, a, b) => String(Math.pow(parseFloat(a), parseFloat(b))))
    .replace(/floor\(([^)]+)\)/gi, (_, n) => String(Math.floor(parseFloat(n))))
    .replace(/ceil\(([^)]+)\)/gi, (_, n) => String(Math.ceil(parseFloat(n))))
    .replace(/round\(([^)]+)\)/gi, (_, n) => String(Math.round(parseFloat(n))))
    .replace(/min\(([^)]+)\)/gi, (_, args) => String(Math.min(...args.split(",").map(Number))))
    .replace(/max\(([^)]+)\)/gi, (_, args) => String(Math.max(...args.split(",").map(Number))))
    .replace(/\^/g, "**")
    .replace(/×/g, "*")
    .replace(/÷/g, "/");

  // Bitwise
  processed = processed
    .replace(/&/g, "&")
    .replace(/\|/g, "|")
    .replace(/~/g, "~")
    .replace(/<<|>>|>>>/, (m) => m);

  // Validate: only allow safe characters
  if (!/^[\d+\-*/().%&|~^<> ,eE]+$/.test(processed)) {
    throw new Error("Invalid expression");
  }

  // Use Function constructor for safe eval
  const fn = new Function(`"use strict"; return (${processed})`);
  const result = fn();

  if (typeof result !== "number" || !isFinite(result)) {
    throw new Error("Invalid result");
  }

  return result;
}

// Number base conversions
function toBase(num: number, base: CalcState["base"]): string {
  const int = Math.trunc(num);
  switch (base) {
    case "hex": return "0x" + int.toString(16).toUpperCase();
    case "bin": return "0b" + int.toString(2);
    case "oct": return "0o" + int.toString(8);
    default: return num.toString();
  }
}

function fromBase(str: string): number {
  str = str.trim();
  if (str.startsWith("0x") || str.startsWith("0X")) return parseInt(str, 16);
  if (str.startsWith("0b") || str.startsWith("0B")) return parseInt(str.slice(2), 2);
  if (str.startsWith("0o") || str.startsWith("0O")) return parseInt(str.slice(2), 8);
  return parseFloat(str);
}

// Byte size formatting
function formatBytes(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1024) return `${n} B`;
  if (abs < 1048576) return `${(n / 1024).toFixed(2)} KB`;
  if (abs < 1073741824) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

// Timestamp conversion
function timestampToDate(n: number): string {
  // Auto-detect milliseconds vs seconds
  const ts = n > 1e12 ? n : n * 1000;
  return new Date(ts).toISOString();
}

function dateToTimestamp(str: string): number {
  return new Date(str).getTime() / 1000;
}

const STORAGE_KEY = "blade-calc-history";
const MAX_HISTORY = 100;

function loadHistory(): CalcHistory[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(h: CalcHistory[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-MAX_HISTORY)));
}

export function useCalculator() {
  const [state, setState] = useState<CalcState>({
    display: "0",
    expression: "",
    result: null,
    base: "dec",
    memory: 0,
    history: loadHistory(),
    error: null,
    angleMode: "rad",
  });

  const input = useCallback((char: string) => {
    setState((prev) => {
      const display = prev.display === "0" && char !== "." ? char : prev.display + char;
      return { ...prev, display, error: null };
    });
  }, []);

  const clear = useCallback(() => {
    setState((prev) => ({ ...prev, display: "0", expression: "", result: null, error: null }));
  }, []);

  const clearEntry = useCallback(() => {
    setState((prev) => ({ ...prev, display: "0", error: null }));
  }, []);

  const backspace = useCallback(() => {
    setState((prev) => ({
      ...prev,
      display: prev.display.length > 1 ? prev.display.slice(0, -1) : "0",
      error: null,
    }));
  }, []);

  const calculate = useCallback(() => {
    setState((prev) => {
      const expr = prev.expression + prev.display;
      try {
        const result = evaluate(expr);
        const formatted = prev.base === "dec" ? result.toString() : toBase(result, prev.base);

        const entry: CalcHistory = {
          id: crypto.randomUUID(),
          expression: expr,
          result: formatted,
          base: prev.base,
          timestamp: Date.now(),
        };

        const history = [...prev.history, entry].slice(-MAX_HISTORY);
        saveHistory(history);

        return { ...prev, display: formatted, expression: "", result: formatted, history, error: null };
      } catch (e) {
        return { ...prev, error: e instanceof Error ? e.message : "Error" };
      }
    });
  }, []);

  const operator = useCallback((op: string) => {
    setState((prev) => ({
      ...prev,
      expression: prev.display + " " + op + " ",
      display: "0",
      error: null,
    }));
  }, []);

  const setBase = useCallback((base: CalcState["base"]) => {
    setState((prev) => {
      const num = fromBase(prev.display);
      const display = isNaN(num) ? "0" : toBase(num, base);
      return { ...prev, base, display };
    });
  }, []);

  const negate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      display: prev.display.startsWith("-") ? prev.display.slice(1) : "-" + prev.display,
    }));
  }, []);

  const percent = useCallback(() => {
    setState((prev) => {
      const num = parseFloat(prev.display);
      return { ...prev, display: isNaN(num) ? "0" : (num / 100).toString() };
    });
  }, []);

  // Memory operations
  const memoryStore = useCallback(() => {
    setState((prev) => ({ ...prev, memory: parseFloat(prev.display) || 0 }));
  }, []);

  const memoryRecall = useCallback(() => {
    setState((prev) => ({ ...prev, display: prev.memory.toString() }));
  }, []);

  const memoryAdd = useCallback(() => {
    setState((prev) => ({ ...prev, memory: prev.memory + (parseFloat(prev.display) || 0) }));
  }, []);

  const memoryClear = useCallback(() => {
    setState((prev) => ({ ...prev, memory: 0 }));
  }, []);

  // Utility conversions
  const convertTimestamp = useCallback((input: string): string => {
    const num = parseFloat(input);
    if (!isNaN(num)) return timestampToDate(num);
    return String(dateToTimestamp(input));
  }, []);

  const convertByteSizes = useCallback((input: string): string => {
    const num = parseFloat(input);
    return isNaN(num) ? "Invalid" : formatBytes(num);
  }, []);

  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, history: [] }));
    saveHistory([]);
  }, []);

  return {
    state,
    input,
    operator,
    calculate,
    clear,
    clearEntry,
    backspace,
    negate,
    percent,
    setBase,
    memoryStore,
    memoryRecall,
    memoryAdd,
    memoryClear,
    convertTimestamp,
    convertByteSizes,
    clearHistory,
    toBase,
    fromBase,
  };
}
