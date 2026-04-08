import { useState, useCallback, useMemo } from "react";

/**
 * Feedback Loop — Makes Blade learn from actual usage, not just prompts.
 *
 * Problem: "Stop making us do prompt tuning. Systems should improve
 * from actual feedback loops in production."
 *
 * Solution: Track what works (👍), what doesn't (👎), and auto-adjust
 * the system prompt based on accumulated feedback patterns.
 *
 * This is the evolution beyond prompt engineering.
 */

export interface FeedbackEntry {
  id: string;
  messageId: string;
  conversationId: string;
  type: "positive" | "negative" | "pin";
  userPrompt: string;      // what the user asked
  aiResponse: string;      // what the AI responded (first 500 chars)
  model: string;
  provider: string;
  timestamp: number;
  tags: string[];           // auto-detected: "code", "explanation", "creative", etc.
}

export interface LearnedPattern {
  id: string;
  pattern: string;          // what Blade learned
  source: "positive" | "negative" | "observation";
  confidence: number;       // 0-1, increases with more supporting feedback
  examples: number;         // how many feedback entries support this
  createdAt: number;
  updatedAt: number;
  active: boolean;          // user can disable patterns
}

export interface FeedbackStats {
  totalPositive: number;
  totalNegative: number;
  totalPins: number;
  patterns: LearnedPattern[];
  topPositiveTags: Array<{ tag: string; count: number }>;
  topNegativeTags: Array<{ tag: string; count: number }>;
  improvementScore: number; // 0-100, based on positive/negative ratio trend
}

const STORAGE_KEY = "blade-feedback";
const PATTERNS_KEY = "blade-learned-patterns";
const MAX_ENTRIES = 500;

function loadFeedback(): FeedbackEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveFeedback(entries: FeedbackEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

function loadPatterns(): LearnedPattern[] {
  try { return JSON.parse(localStorage.getItem(PATTERNS_KEY) || "[]"); }
  catch { return []; }
}

function savePatterns(patterns: LearnedPattern[]) {
  localStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
}

// Auto-detect tags from content
function autoTag(userPrompt: string, aiResponse: string): string[] {
  const combined = (userPrompt + " " + aiResponse).toLowerCase();
  const tags: string[] = [];

  const detectors: Array<{ tag: string; keywords: string[] }> = [
    { tag: "code", keywords: ["function", "class", "import", "const", "let", "var", "```", "code", "implement", "fix", "bug", "error"] },
    { tag: "explanation", keywords: ["explain", "how does", "what is", "why", "describe", "tell me about"] },
    { tag: "creative", keywords: ["write", "draft", "compose", "brainstorm", "ideas", "story", "poem"] },
    { tag: "analysis", keywords: ["analyze", "compare", "review", "evaluate", "assess", "pros and cons"] },
    { tag: "data", keywords: ["data", "csv", "json", "sql", "database", "query", "table", "chart"] },
    { tag: "devops", keywords: ["deploy", "docker", "ci/cd", "pipeline", "kubernetes", "server", "cloud"] },
    { tag: "design", keywords: ["design", "ui", "ux", "layout", "css", "style", "component", "tailwind"] },
    { tag: "debugging", keywords: ["debug", "error", "fix", "crash", "broken", "issue", "traceback", "stack"] },
    { tag: "refactoring", keywords: ["refactor", "clean", "improve", "optimize", "simplify", "restructure"] },
    { tag: "documentation", keywords: ["document", "readme", "docs", "api docs", "jsdoc", "comment"] },
    { tag: "testing", keywords: ["test", "spec", "jest", "vitest", "assert", "expect", "mock", "coverage"] },
    { tag: "research", keywords: ["research", "search", "find", "look up", "investigate", "explore"] },
  ];

  for (const { tag, keywords } of detectors) {
    if (keywords.filter((kw) => combined.includes(kw)).length >= 2) {
      tags.push(tag);
    }
  }

  // Detect response style preferences
  if (aiResponse.length < 200) tags.push("concise");
  if (aiResponse.length > 1000) tags.push("detailed");
  if (aiResponse.includes("```")) tags.push("has-code");
  if (aiResponse.includes("1.") || aiResponse.includes("- ")) tags.push("structured");

  return tags;
}

// Derive patterns from accumulated feedback
function derivePatterns(entries: FeedbackEntry[]): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];
  const now = Date.now();

  // Count tag frequencies by feedback type
  const positiveTags: Record<string, number> = {};
  const negativeTags: Record<string, number> = {};

  for (const entry of entries) {
    const target = entry.type === "positive" ? positiveTags : entry.type === "negative" ? negativeTags : null;
    if (!target) continue;
    for (const tag of entry.tags) {
      target[tag] = (target[tag] || 0) + 1;
    }
  }

  // Generate "do more of" patterns from positive feedback
  for (const [tag, count] of Object.entries(positiveTags)) {
    if (count >= 3) {
      const negCount = negativeTags[tag] || 0;
      const ratio = count / (count + negCount);
      if (ratio > 0.6) {
        patterns.push({
          id: `pos-${tag}`,
          pattern: `User consistently appreciates ${tag} responses. Lean into this style when relevant.`,
          source: "positive",
          confidence: Math.min(ratio, 0.95),
          examples: count,
          createdAt: now,
          updatedAt: now,
          active: true,
        });
      }
    }
  }

  // Generate "avoid" patterns from negative feedback
  for (const [tag, count] of Object.entries(negativeTags)) {
    if (count >= 3) {
      const posCount = positiveTags[tag] || 0;
      const ratio = count / (count + posCount);
      if (ratio > 0.6) {
        patterns.push({
          id: `neg-${tag}`,
          pattern: `User often dislikes ${tag} responses. Adjust approach — be more ${tag === "detailed" ? "concise" : tag === "concise" ? "detailed" : "careful"} in this area.`,
          source: "negative",
          confidence: Math.min(ratio, 0.95),
          examples: count,
          createdAt: now,
          updatedAt: now,
          active: true,
        });
      }
    }
  }

  // Detect style preferences
  const positiveEntries = entries.filter((e) => e.type === "positive");
  const concisePositive = positiveEntries.filter((e) => e.tags.includes("concise")).length;
  const detailedPositive = positiveEntries.filter((e) => e.tags.includes("detailed")).length;

  if (concisePositive > detailedPositive + 3) {
    patterns.push({
      id: "style-concise",
      pattern: "User strongly prefers concise, direct responses. Avoid unnecessary elaboration.",
      source: "observation",
      confidence: 0.8,
      examples: concisePositive,
      createdAt: now,
      updatedAt: now,
      active: true,
    });
  } else if (detailedPositive > concisePositive + 3) {
    patterns.push({
      id: "style-detailed",
      pattern: "User prefers thorough, detailed responses with explanations and examples.",
      source: "observation",
      confidence: 0.8,
      examples: detailedPositive,
      createdAt: now,
      updatedAt: now,
      active: true,
    });
  }

  const structuredPositive = positiveEntries.filter((e) => e.tags.includes("structured")).length;
  if (structuredPositive > positiveEntries.length * 0.5 && structuredPositive >= 5) {
    patterns.push({
      id: "style-structured",
      pattern: "User likes structured responses (numbered lists, bullet points, headers).",
      source: "observation",
      confidence: 0.75,
      examples: structuredPositive,
      createdAt: now,
      updatedAt: now,
      active: true,
    });
  }

  return patterns;
}

export function useFeedbackLoop() {
  const [entries, setEntries] = useState<FeedbackEntry[]>(loadFeedback);
  const [patterns, setPatterns] = useState<LearnedPattern[]>(loadPatterns);

  const recordFeedback = useCallback((
    type: FeedbackEntry["type"],
    messageId: string,
    conversationId: string,
    userPrompt: string,
    aiResponse: string,
    model: string,
    provider: string,
  ) => {
    const tags = autoTag(userPrompt, aiResponse);
    const entry: FeedbackEntry = {
      id: crypto.randomUUID(),
      messageId,
      conversationId,
      type,
      userPrompt: userPrompt.slice(0, 500),
      aiResponse: aiResponse.slice(0, 500),
      model,
      provider,
      timestamp: Date.now(),
      tags,
    };

    setEntries((prev) => {
      const next = [...prev, entry].slice(-MAX_ENTRIES);
      saveFeedback(next);

      // Re-derive patterns every 10 entries
      if (next.length % 10 === 0) {
        const newPatterns = derivePatterns(next);
        setPatterns(newPatterns);
        savePatterns(newPatterns);
      }

      return next;
    });
  }, []);

  const togglePattern = useCallback((patternId: string) => {
    setPatterns((prev) => {
      const next = prev.map((p) => p.id === patternId ? { ...p, active: !p.active } : p);
      savePatterns(next);
      return next;
    });
  }, []);

  const regeneratePatterns = useCallback(() => {
    const newPatterns = derivePatterns(entries);
    setPatterns(newPatterns);
    savePatterns(newPatterns);
  }, [entries]);

  // Generate system prompt additions from active patterns
  const getLearnedContext = useCallback((): string => {
    const activePatterns = patterns.filter((p) => p.active);
    if (activePatterns.length === 0) return "";

    const lines = [
      "[Learned from user feedback — adjust behavior accordingly]",
      ...activePatterns.map((p) => `- ${p.pattern} (confidence: ${Math.round(p.confidence * 100)}%, based on ${p.examples} examples)`),
    ];
    return lines.join("\n");
  }, [patterns]);

  const stats = useMemo((): FeedbackStats => {
    const positive = entries.filter((e) => e.type === "positive");
    const negative = entries.filter((e) => e.type === "negative");
    const pins = entries.filter((e) => e.type === "pin");

    const posTagCounts: Record<string, number> = {};
    const negTagCounts: Record<string, number> = {};

    for (const e of positive) {
      for (const tag of e.tags) posTagCounts[tag] = (posTagCounts[tag] || 0) + 1;
    }
    for (const e of negative) {
      for (const tag of e.tags) negTagCounts[tag] = (negTagCounts[tag] || 0) + 1;
    }

    const total = positive.length + negative.length;
    const improvementScore = total > 0 ? Math.round((positive.length / total) * 100) : 50;

    return {
      totalPositive: positive.length,
      totalNegative: negative.length,
      totalPins: pins.length,
      patterns,
      topPositiveTags: Object.entries(posTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count })),
      topNegativeTags: Object.entries(negTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count })),
      improvementScore,
    };
  }, [entries, patterns]);

  const clearFeedback = useCallback(() => {
    setEntries([]);
    setPatterns([]);
    saveFeedback([]);
    savePatterns([]);
  }, []);

  return {
    entries,
    patterns,
    stats,
    recordFeedback,
    togglePattern,
    regeneratePatterns,
    getLearnedContext,
    clearFeedback,
  };
}
