import { useMemo } from "react";

/**
 * Diff Viewer — compare two texts side by side with highlighting.
 * Used for code review, version comparison, merge conflicts.
 */

export interface DiffLine {
  type: "added" | "removed" | "unchanged" | "header";
  lineNumberOld: number | null;
  lineNumberNew: number | null;
  content: string;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  unchanged: number;
  similarity: number; // 0-100
}

// Simple LCS-based diff algorithm
function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const temp: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ type: "unchanged", lineNumberOld: i, lineNumberNew: j, content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: "added", lineNumberOld: null, lineNumberNew: j, content: newLines[j - 1] });
      j--;
    } else {
      temp.push({ type: "removed", lineNumberOld: i, lineNumberNew: null, content: oldLines[i - 1] });
      i--;
    }
  }

  // Reverse since we backtracked
  for (let k = temp.length - 1; k >= 0; k--) {
    result.push(temp[k]);
  }

  const additions = result.filter((l) => l.type === "added").length;
  const deletions = result.filter((l) => l.type === "removed").length;
  const unchanged = result.filter((l) => l.type === "unchanged").length;
  const total = Math.max(m, n);
  const similarity = total > 0 ? Math.round((unchanged / total) * 100) : 100;

  return { lines: result, additions, deletions, unchanged, similarity };
}

// Compute inline character-level diff for a changed line pair
function inlineDiff(oldLine: string, newLine: string): Array<{ type: "same" | "add" | "remove"; text: string }> {
  const result: Array<{ type: "same" | "add" | "remove"; text: string }> = [];
  const oldChars = oldLine.split("");
  const newChars = newLine.split("");
  const m = oldChars.length;
  const n = newChars.length;

  // Simple character LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldChars[i - 1] === newChars[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  let ci = m, cj = n;
  const temp: Array<{ type: "same" | "add" | "remove"; char: string }> = [];

  while (ci > 0 || cj > 0) {
    if (ci > 0 && cj > 0 && oldChars[ci - 1] === newChars[cj - 1]) {
      temp.push({ type: "same", char: oldChars[ci - 1] });
      ci--; cj--;
    } else if (cj > 0 && (ci === 0 || dp[ci][cj - 1] >= dp[ci - 1][cj])) {
      temp.push({ type: "add", char: newChars[cj - 1] });
      cj--;
    } else {
      temp.push({ type: "remove", char: oldChars[ci - 1] });
      ci--;
    }
  }

  temp.reverse();

  // Merge consecutive same-type characters
  let current: { type: "same" | "add" | "remove"; text: string } | null = null;
  for (const item of temp) {
    if (current && current.type === item.type) {
      current.text += item.char;
    } else {
      if (current) result.push(current);
      current = { type: item.type, text: item.char };
    }
  }
  if (current) result.push(current);

  return result;
}

// Generate unified diff format string
function toUnifiedDiff(oldText: string, newText: string, oldName = "a", newName = "b"): string {
  const diff = computeDiff(oldText, newText);
  const lines = [
    `--- ${oldName}`,
    `+++ ${newName}`,
    `@@ -1,${oldText.split("\n").length} +1,${newText.split("\n").length} @@`,
  ];

  for (const line of diff.lines) {
    switch (line.type) {
      case "added": lines.push(`+${line.content}`); break;
      case "removed": lines.push(`-${line.content}`); break;
      case "unchanged": lines.push(` ${line.content}`); break;
    }
  }

  return lines.join("\n");
}

// Apply a patch (simple — just extract the "after" content)
function applyPatch(diff: DiffResult): string {
  return diff.lines
    .filter((l) => l.type === "added" || l.type === "unchanged")
    .map((l) => l.content)
    .join("\n");
}

// Reverse a patch
function reversePatch(diff: DiffResult): string {
  return diff.lines
    .filter((l) => l.type === "removed" || l.type === "unchanged")
    .map((l) => l.content)
    .join("\n");
}

export function useDiffViewer(oldText: string, newText: string) {
  const diff = useMemo(() => computeDiff(oldText, newText), [oldText, newText]);

  const unifiedDiff = useMemo(() => toUnifiedDiff(oldText, newText), [oldText, newText]);

  return {
    diff,
    unifiedDiff,
    inlineDiff,
    applyPatch: () => applyPatch(diff),
    reversePatch: () => reversePatch(diff),
  };
}

export { computeDiff, inlineDiff, toUnifiedDiff };
