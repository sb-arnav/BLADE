import { useState, useCallback, useMemo } from "react";

/**
 * Regex Tester — test and debug regular expressions with AI help.
 * Like regex101 but built into Blade with AI explanations.
 */

export interface RegexMatch {
  fullMatch: string;
  groups: string[];
  index: number;
  length: number;
}

export interface SavedRegex {
  id: string;
  pattern: string;
  flags: string;
  description: string;
  testString: string;
  tags: string[];
  createdAt: number;
  usageCount: number;
}

export interface RegexTestResult {
  valid: boolean;
  error: string | null;
  matches: RegexMatch[];
  matchCount: number;
  executionTime: number;
}

const STORAGE_KEY = "blade-saved-regex";

const COMMON_PATTERNS: Array<{ name: string; pattern: string; flags: string; description: string }> = [
  { name: "Email", pattern: "[\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,}", flags: "gi", description: "Match email addresses" },
  { name: "URL", pattern: "https?://[\\w.-]+(?:\\.[\\w.-]+)+[\\w.,@?^=%&:/~+#-]*", flags: "gi", description: "Match HTTP/HTTPS URLs" },
  { name: "IP Address", pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", flags: "g", description: "Match IPv4 addresses" },
  { name: "Phone (US)", pattern: "(?:\\+1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}", flags: "g", description: "Match US phone numbers" },
  { name: "Date (ISO)", pattern: "\\d{4}-\\d{2}-\\d{2}", flags: "g", description: "Match YYYY-MM-DD dates" },
  { name: "Hex Color", pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b", flags: "gi", description: "Match hex color codes" },
  { name: "HTML Tag", pattern: "<\\/?[a-zA-Z][a-zA-Z0-9]*(?:\\s[^>]*)?\\/?>", flags: "gi", description: "Match HTML tags" },
  { name: "JSON Key", pattern: '"([^"]+)"\\s*:', flags: "g", description: "Match JSON object keys" },
  { name: "Import Statement", pattern: "import\\s+(?:{[^}]+}|\\w+)\\s+from\\s+['\"][^'\"]+['\"]", flags: "gm", description: "Match JS/TS import statements" },
  { name: "Function Declaration", pattern: "(?:function|const|let|var)\\s+(\\w+)\\s*(?:=\\s*)?\\(", flags: "gm", description: "Match function declarations" },
  { name: "CSS Class", pattern: "\\.[a-zA-Z][\\w-]*", flags: "g", description: "Match CSS class selectors" },
  { name: "UUID", pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", flags: "gi", description: "Match UUIDs" },
];

function testRegex(pattern: string, flags: string, testString: string): RegexTestResult {
  const start = performance.now();

  try {
    const regex = new RegExp(pattern, flags);
    const matches: RegexMatch[] = [];

    if (flags.includes("g")) {
      let match;
      while ((match = regex.exec(testString)) !== null) {
        matches.push({
          fullMatch: match[0],
          groups: match.slice(1),
          index: match.index,
          length: match[0].length,
        });
        // Prevent infinite loops with zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
        if (matches.length > 1000) break;
      }
    } else {
      const match = testString.match(regex);
      if (match) {
        matches.push({
          fullMatch: match[0],
          groups: match.slice(1),
          index: match.index || 0,
          length: match[0].length,
        });
      }
    }

    return {
      valid: true,
      error: null,
      matches,
      matchCount: matches.length,
      executionTime: performance.now() - start,
    };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : String(e),
      matches: [],
      matchCount: 0,
      executionTime: performance.now() - start,
    };
  }
}

function loadSaved(): SavedRegex[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveSaved(regexes: SavedRegex[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(regexes));
}

export function useRegexTester() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [testString, setTestString] = useState("");
  const [saved, setSaved] = useState<SavedRegex[]>(loadSaved);

  const result = useMemo((): RegexTestResult => {
    if (!pattern || !testString) {
      return { valid: true, error: null, matches: [], matchCount: 0, executionTime: 0 };
    }
    return testRegex(pattern, flags, testString);
  }, [pattern, flags, testString]);

  const saveRegex = useCallback((description: string, tags: string[] = []) => {
    const entry: SavedRegex = {
      id: crypto.randomUUID(),
      pattern,
      flags,
      description,
      testString,
      tags,
      createdAt: Date.now(),
      usageCount: 0,
    };
    setSaved((prev) => {
      const next = [...prev, entry];
      saveSaved(next);
      return next;
    });
  }, [pattern, flags, testString]);

  const loadRegex = useCallback((id: string) => {
    const entry = saved.find((s) => s.id === id);
    if (!entry) return;
    setPattern(entry.pattern);
    setFlags(entry.flags);
    setTestString(entry.testString);
    setSaved((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, usageCount: s.usageCount + 1 } : s);
      saveSaved(next);
      return next;
    });
  }, [saved]);

  const deleteRegex = useCallback((id: string) => {
    setSaved((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSaved(next);
      return next;
    });
  }, []);

  const loadCommonPattern = useCallback((index: number) => {
    const p = COMMON_PATTERNS[index];
    if (!p) return;
    setPattern(p.pattern);
    setFlags(p.flags);
  }, []);

  const generateExplainPrompt = useCallback((): string => {
    return `Explain this regular expression in plain English, step by step:\n\nPattern: \`/${pattern}/${flags}\`\n\nBreak down each part of the pattern and explain what it matches. Include examples of strings that would and wouldn't match.`;
  }, [pattern, flags]);

  const toggleFlag = useCallback((flag: string) => {
    setFlags((prev) =>
      prev.includes(flag)
        ? prev.replace(flag, "")
        : prev + flag,
    );
  }, []);

  return {
    pattern,
    setPattern,
    flags,
    setFlags,
    toggleFlag,
    testString,
    setTestString,
    result,
    saved,
    saveRegex,
    loadRegex,
    deleteRegex,
    commonPatterns: COMMON_PATTERNS,
    loadCommonPattern,
    generateExplainPrompt,
  };
}
