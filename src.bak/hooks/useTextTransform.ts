import { useCallback } from "react";

/**
 * Text Transform — quick text manipulation utilities.
 * Case conversion, encoding, hashing, formatting.
 */

export type TransformType =
  | "uppercase" | "lowercase" | "title-case" | "sentence-case" | "camel-case"
  | "pascal-case" | "snake-case" | "kebab-case" | "constant-case"
  | "reverse" | "sort-lines" | "unique-lines" | "remove-empty-lines"
  | "remove-duplicates" | "trim-lines" | "number-lines"
  | "base64-encode" | "base64-decode" | "url-encode" | "url-decode"
  | "html-encode" | "html-decode" | "json-escape" | "json-unescape"
  | "md5-hash" | "count-words" | "count-chars" | "count-lines"
  | "extract-emails" | "extract-urls" | "extract-numbers"
  | "csv-to-json" | "json-to-csv" | "markdown-to-text" | "slug";

const TRANSFORMS: Record<TransformType, { label: string; category: string; fn: (input: string) => string }> = {
  "uppercase": { label: "UPPERCASE", category: "case", fn: (s) => s.toUpperCase() },
  "lowercase": { label: "lowercase", category: "case", fn: (s) => s.toLowerCase() },
  "title-case": { label: "Title Case", category: "case", fn: (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()) },
  "sentence-case": { label: "Sentence case", category: "case", fn: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() },
  "camel-case": { label: "camelCase", category: "case", fn: (s) => s.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toLowerCase()) },
  "pascal-case": { label: "PascalCase", category: "case", fn: (s) => s.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toUpperCase()) },
  "snake-case": { label: "snake_case", category: "case", fn: (s) => s.replace(/([A-Z])/g, "_$1").replace(/[-\s]+/g, "_").toLowerCase().replace(/^_/, "") },
  "kebab-case": { label: "kebab-case", category: "case", fn: (s) => s.replace(/([A-Z])/g, "-$1").replace(/[_\s]+/g, "-").toLowerCase().replace(/^-/, "") },
  "constant-case": { label: "CONSTANT_CASE", category: "case", fn: (s) => s.replace(/([A-Z])/g, "_$1").replace(/[-\s]+/g, "_").toUpperCase().replace(/^_/, "") },
  "reverse": { label: "Reverse text", category: "transform", fn: (s) => s.split("").reverse().join("") },
  "sort-lines": { label: "Sort lines", category: "lines", fn: (s) => s.split("\n").sort().join("\n") },
  "unique-lines": { label: "Unique lines", category: "lines", fn: (s) => [...new Set(s.split("\n"))].join("\n") },
  "remove-empty-lines": { label: "Remove empty lines", category: "lines", fn: (s) => s.split("\n").filter((l) => l.trim()).join("\n") },
  "remove-duplicates": { label: "Remove duplicates", category: "lines", fn: (s) => [...new Set(s.split("\n"))].join("\n") },
  "trim-lines": { label: "Trim lines", category: "lines", fn: (s) => s.split("\n").map((l) => l.trim()).join("\n") },
  "number-lines": { label: "Number lines", category: "lines", fn: (s) => s.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") },
  "base64-encode": { label: "Base64 encode", category: "encode", fn: (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch { return s; } } },
  "base64-decode": { label: "Base64 decode", category: "encode", fn: (s) => { try { return decodeURIComponent(escape(atob(s))); } catch { return s; } } },
  "url-encode": { label: "URL encode", category: "encode", fn: (s) => encodeURIComponent(s) },
  "url-decode": { label: "URL decode", category: "encode", fn: (s) => { try { return decodeURIComponent(s); } catch { return s; } } },
  "html-encode": { label: "HTML encode", category: "encode", fn: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") },
  "html-decode": { label: "HTML decode", category: "encode", fn: (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') },
  "json-escape": { label: "JSON escape", category: "encode", fn: (s) => JSON.stringify(s).slice(1, -1) },
  "json-unescape": { label: "JSON unescape", category: "encode", fn: (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } } },
  "md5-hash": { label: "Simple hash", category: "hash", fn: (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(16).padStart(8, "0"); } },
  "count-words": { label: "Count words", category: "stats", fn: (s) => `${s.split(/\s+/).filter(Boolean).length} words` },
  "count-chars": { label: "Count characters", category: "stats", fn: (s) => `${s.length} characters (${s.replace(/\s/g, "").length} without spaces)` },
  "count-lines": { label: "Count lines", category: "stats", fn: (s) => `${s.split("\n").length} lines (${s.split("\n").filter((l) => l.trim()).length} non-empty)` },
  "extract-emails": { label: "Extract emails", category: "extract", fn: (s) => (s.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []).join("\n") || "No emails found" },
  "extract-urls": { label: "Extract URLs", category: "extract", fn: (s) => (s.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g) || []).join("\n") || "No URLs found" },
  "extract-numbers": { label: "Extract numbers", category: "extract", fn: (s) => (s.match(/-?[\d,]+\.?\d*/g) || []).join("\n") || "No numbers found" },
  "csv-to-json": {
    label: "CSV to JSON",
    category: "convert",
    fn: (s) => {
      const lines = s.trim().split("\n");
      if (lines.length < 2) return "[]";
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
      });
      return JSON.stringify(rows, null, 2);
    },
  },
  "json-to-csv": {
    label: "JSON to CSV",
    category: "convert",
    fn: (s) => {
      try {
        const arr = JSON.parse(s);
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const headers = Object.keys(arr[0]);
        const rows = arr.map((obj: Record<string, unknown>) => headers.map((h) => `"${String(obj[h] ?? "").replace(/"/g, '""')}"`).join(","));
        return [headers.join(","), ...rows].join("\n");
      } catch { return s; }
    },
  },
  "markdown-to-text": {
    label: "Markdown to plain text",
    category: "convert",
    fn: (s) => s
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      .replace(/#{1,6}\s+/g, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/>\s+/g, "")
      .replace(/[-*+]\s+/g, "")
      .replace(/\d+\.\s+/g, "")
      .replace(/---+/g, "")
      .trim(),
  },
  "slug": { label: "URL slug", category: "convert", fn: (s) => s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/--+/g, "-").trim() },
};

const CATEGORIES = [
  { id: "case", label: "Case" },
  { id: "lines", label: "Lines" },
  { id: "encode", label: "Encode/Decode" },
  { id: "hash", label: "Hash" },
  { id: "stats", label: "Stats" },
  { id: "extract", label: "Extract" },
  { id: "convert", label: "Convert" },
  { id: "transform", label: "Transform" },
];

export function useTextTransform() {
  const transform = useCallback((input: string, type: TransformType): string => {
    const t = TRANSFORMS[type];
    return t ? t.fn(input) : input;
  }, []);

  const getTransforms = useCallback(() => {
    return Object.entries(TRANSFORMS).map(([id, t]) => ({
      id: id as TransformType,
      label: t.label,
      category: t.category,
    }));
  }, []);

  const getByCategory = useCallback((category: string) => {
    return Object.entries(TRANSFORMS)
      .filter(([, t]) => t.category === category)
      .map(([id, t]) => ({ id: id as TransformType, label: t.label }));
  }, []);

  const chainTransforms = useCallback((input: string, types: TransformType[]): string => {
    return types.reduce((text, type) => transform(text, type), input);
  }, [transform]);

  return { transform, getTransforms, getByCategory, chainTransforms, categories: CATEGORIES };
}
