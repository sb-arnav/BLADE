import { useMemo } from "react";
import { Message } from "../types";

export interface ConversationInsights {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalWords: number;
  userWords: number;
  assistantWords: number;
  averageUserLength: number;
  averageAssistantLength: number;
  codeBlockCount: number;
  imageCount: number;
  longestMessage: { role: string; words: number } | null;
  topTopics: string[];
  sentiment: "positive" | "neutral" | "negative";
  complexity: "simple" | "moderate" | "complex";
  duration: number; // ms from first to last message
  messagesPerMinute: number;
  languages: string[];
}

const CODE_BLOCK_REGEX = /```(\w*)\n[\s\S]*?```/g;

const TOPIC_KEYWORDS: Record<string, string[]> = {
  "coding": ["code", "function", "bug", "error", "debug", "compile", "syntax", "api", "database", "git"],
  "writing": ["write", "draft", "essay", "blog", "article", "story", "content", "copy"],
  "design": ["design", "ui", "ux", "layout", "color", "font", "css", "style", "figma"],
  "data": ["data", "analysis", "chart", "graph", "statistics", "csv", "json", "sql"],
  "devops": ["deploy", "docker", "kubernetes", "ci", "cd", "pipeline", "server", "cloud", "aws"],
  "ai/ml": ["model", "training", "neural", "gpt", "llm", "prompt", "embedding", "fine-tune"],
  "business": ["strategy", "market", "revenue", "customer", "product", "roadmap", "okr"],
  "learning": ["explain", "how", "why", "what is", "tutorial", "learn", "understand"],
};

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  "TypeScript": /```(?:ts|tsx|typescript)/i,
  "JavaScript": /```(?:js|jsx|javascript)/i,
  "Python": /```(?:py|python)/i,
  "Rust": /```(?:rs|rust)/i,
  "Go": /```(?:go|golang)/i,
  "Java": /```(?:java)\b/i,
  "C++": /```(?:cpp|c\+\+)/i,
  "SQL": /```(?:sql)/i,
  "Bash": /```(?:bash|sh|shell|zsh)/i,
  "HTML": /```(?:html|xml)/i,
  "CSS": /```(?:css|scss|sass)/i,
  "JSON": /```(?:json)/i,
  "YAML": /```(?:yaml|yml)/i,
  "Markdown": /```(?:md|markdown)/i,
};

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function detectTopics(messages: Message[]): string[] {
  const allText = messages.map((m) => m.content.toLowerCase()).join(" ");
  const scores: [string, number][] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter((kw) => allText.includes(kw)).length;
    if (score >= 2) scores.push([topic, score]);
  }

  return scores
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);
}

function detectSentiment(messages: Message[]): "positive" | "neutral" | "negative" {
  const assistantText = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.toLowerCase())
    .join(" ");

  const positiveWords = ["great", "excellent", "perfect", "awesome", "wonderful", "fantastic", "good", "nice", "helpful", "correct", "yes", "absolutely"];
  const negativeWords = ["error", "fail", "wrong", "issue", "problem", "bug", "crash", "broken", "cannot", "unfortunately", "sorry"];

  const posCount = positiveWords.filter((w) => assistantText.includes(w)).length;
  const negCount = negativeWords.filter((w) => assistantText.includes(w)).length;

  if (posCount > negCount + 2) return "positive";
  if (negCount > posCount + 2) return "negative";
  return "neutral";
}

function detectComplexity(messages: Message[]): "simple" | "moderate" | "complex" {
  const avgLength = messages.reduce((sum, m) => sum + countWords(m.content), 0) / Math.max(messages.length, 1);
  const codeBlocks = messages.reduce((sum, m) => sum + (m.content.match(CODE_BLOCK_REGEX) || []).length, 0);
  const hasImages = messages.some((m) => m.image_base64);

  let score = 0;
  if (avgLength > 100) score += 2;
  else if (avgLength > 40) score += 1;
  if (codeBlocks > 3) score += 2;
  else if (codeBlocks > 0) score += 1;
  if (hasImages) score += 1;
  if (messages.length > 10) score += 1;

  if (score >= 4) return "complex";
  if (score >= 2) return "moderate";
  return "simple";
}

function detectLanguages(messages: Message[]): string[] {
  const allContent = messages.map((m) => m.content).join("\n");
  const found: string[] = [];

  for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
    if (pattern.test(allContent)) found.push(lang);
  }

  return found;
}

export function useConversationInsights(messages: Message[]): ConversationInsights {
  return useMemo(() => {
    const userMsgs = messages.filter((m) => m.role === "user");
    const assistantMsgs = messages.filter((m) => m.role === "assistant");

    const userWords = userMsgs.reduce((sum, m) => sum + countWords(m.content), 0);
    const assistantWords = assistantMsgs.reduce((sum, m) => sum + countWords(m.content), 0);
    const totalWords = userWords + assistantWords;

    const allContent = messages.map((m) => m.content).join("\n");
    const codeBlocks = (allContent.match(CODE_BLOCK_REGEX) || []).length;
    const imageCount = messages.filter((m) => m.image_base64).length;

    let longestMessage: { role: string; words: number } | null = null;
    for (const msg of messages) {
      const wc = countWords(msg.content);
      if (!longestMessage || wc > longestMessage.words) {
        longestMessage = { role: msg.role, words: wc };
      }
    }

    const timestamps = messages.map((m) => m.timestamp).filter((t) => t > 0);
    const duration = timestamps.length >= 2
      ? Math.max(...timestamps) - Math.min(...timestamps)
      : 0;
    const durationMinutes = duration / 60000;
    const messagesPerMinute = durationMinutes > 0
      ? Math.round((messages.length / durationMinutes) * 10) / 10
      : 0;

    return {
      totalMessages: messages.length,
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      totalWords,
      userWords,
      assistantWords,
      averageUserLength: userMsgs.length > 0 ? Math.round(userWords / userMsgs.length) : 0,
      averageAssistantLength: assistantMsgs.length > 0 ? Math.round(assistantWords / assistantMsgs.length) : 0,
      codeBlockCount: codeBlocks,
      imageCount,
      longestMessage,
      topTopics: detectTopics(messages),
      sentiment: detectSentiment(messages),
      complexity: detectComplexity(messages),
      duration,
      messagesPerMinute,
      languages: detectLanguages(messages),
    };
  }, [messages]);
}
