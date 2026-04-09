/**
 * AI utilities for Blade.
 * Prompt construction, token estimation, context assembly,
 * response parsing, and model-specific formatting.
 */

// ── Token estimation ────────────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Uses the ~4 chars/token heuristic for English.
 * More accurate for GPT-family; Claude tends to be ~3.5 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Average of different tokenizer behaviors
  return Math.ceil(text.length / 3.8);
}

/**
 * Estimate tokens for a message array (includes role overhead)
 */
export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => {
    return sum + estimateTokens(m.content) + 4; // 4 tokens overhead per message (role, formatting)
  }, 3); // 3 tokens for system formatting
}

/**
 * Truncate text to fit within a token budget
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  const ratio = maxTokens / currentTokens;
  const targetChars = Math.floor(text.length * ratio * 0.95); // 5% safety margin
  return text.slice(0, targetChars) + "\n...[truncated to fit context window]";
}

// ── Prompt construction ─────────────────────────────────────────────────

export interface PromptContext {
  systemPrompt?: string;
  soulContext?: string;
  learnedPatterns?: string;
  knowledgeContext?: string;
  memoryContext?: string;
  compressedHistory?: string;
  customInstructions?: string;
}

/**
 * Assemble a complete system prompt from all context sources.
 * Respects priority ordering and token budgets.
 */
export function assembleSystemPrompt(context: PromptContext, maxTokens = 4000): string {
  const sections: Array<{ label: string; content: string; priority: number }> = [];

  if (context.systemPrompt) {
    sections.push({ label: "Core", content: context.systemPrompt, priority: 1 });
  }

  if (context.soulContext) {
    sections.push({ label: "User Profile", content: context.soulContext, priority: 2 });
  }

  if (context.learnedPatterns) {
    sections.push({ label: "Learned Preferences", content: context.learnedPatterns, priority: 3 });
  }

  if (context.customInstructions) {
    sections.push({ label: "Custom Instructions", content: context.customInstructions, priority: 4 });
  }

  if (context.memoryContext) {
    sections.push({ label: "Relevant Memories", content: context.memoryContext, priority: 5 });
  }

  if (context.knowledgeContext) {
    sections.push({ label: "Knowledge Context", content: context.knowledgeContext, priority: 6 });
  }

  if (context.compressedHistory) {
    sections.push({ label: "Previous Context", content: context.compressedHistory, priority: 7 });
  }

  // Sort by priority and assemble within budget
  sections.sort((a, b) => a.priority - b.priority);

  const lines: string[] = [];
  let totalTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);
    if (totalTokens + sectionTokens > maxTokens) {
      // Truncate this section to fit
      const remaining = maxTokens - totalTokens;
      if (remaining > 50) {
        lines.push(truncateToTokenBudget(section.content, remaining));
      }
      break;
    }
    lines.push(section.content);
    totalTokens += sectionTokens;
  }

  return lines.join("\n\n");
}

// ── Response parsing ────────────────────────────────────────────────────

/**
 * Extract structured data from AI responses
 */
export function extractJSON(response: string): unknown | null {
  // Try to find JSON in code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* fall through */ }
  }

  // Try to find JSON object/array directly
  const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Extract a list of items from AI response (numbered or bulleted)
 */
export function extractList(response: string): string[] {
  const lines = response.split("\n");
  const items: string[] = [];

  for (const line of lines) {
    // Numbered: "1. item" or "1) item"
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (numbered) { items.push(numbered[1].trim()); continue; }

    // Bulleted: "- item" or "* item" or "• item"
    const bulleted = line.match(/^\s*[-*•]\s+(.+)/);
    if (bulleted) { items.push(bulleted[1].trim()); continue; }
  }

  return items;
}

/**
 * Extract key-value pairs from AI response
 */
export function extractKeyValues(response: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = response.split("\n");

  for (const line of lines) {
    // "Key: Value" or "**Key**: Value" or "Key — Value"
    const match = line.match(/^\s*\*{0,2}([^:—]+?)\*{0,2}\s*[:—]\s*(.+)/);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }

  return result;
}

/**
 * Extract code blocks with language detection
 */
export function extractCode(response: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    blocks.push({
      language: match[1] || detectLanguage(match[2]),
      code: match[2].trim(),
    });
  }

  return blocks;
}

/**
 * Simple language detection from code content
 */
function detectLanguage(code: string): string {
  if (/^import\s|^from\s.*import|def\s+\w+|class\s+\w+.*:/m.test(code)) return "python";
  if (/^import\s|^export\s|const\s|let\s|interface\s|type\s/m.test(code)) return "typescript";
  if (/^function\s|var\s|=>\s*{|\.then\(/m.test(code)) return "javascript";
  if (/^fn\s|^pub\s|^use\s|^mod\s|^struct\s|^impl\s/m.test(code)) return "rust";
  if (/^package\s|^func\s|^type\s.*struct/m.test(code)) return "go";
  if (/^public\s|^private\s|^class\s.*{|^import\s+java/m.test(code)) return "java";
  if (/^SELECT\s|^INSERT\s|^CREATE\s|^ALTER\s/im.test(code)) return "sql";
  if (/^\$|^#!.*bash|^echo\s|^if\s*\[/m.test(code)) return "bash";
  if (/^<\?php|^\$\w+\s*=/m.test(code)) return "php";
  if (/^<!DOCTYPE|^<html|^<div/im.test(code)) return "html";
  if (/^[.#]\w+\s*{|^@media|^@import/m.test(code)) return "css";
  if (/^\s*[\[{]|":\s*[{\["]/m.test(code)) return "json";
  if (/^\w+:\s*$/m.test(code)) return "yaml";
  return "text";
}

// ── Prompt templates ────────────────────────────────────────────────────

export function buildChatPrompt(userMessage: string, options?: {
  skillMode?: string;
  context?: string;
}): string {
  let prompt = userMessage;

  if (options?.context) {
    prompt = `${options.context}\n\n---\n\n${prompt}`;
  }

  return prompt;
}

export function buildSummaryPrompt(text: string, type: "brief" | "detailed" | "bullets" = "brief"): string {
  const instructions: Record<string, string> = {
    brief: "Summarize in 2-3 sentences.",
    detailed: "Provide a comprehensive summary covering all key points.",
    bullets: "Summarize as a bulleted list of key points.",
  };
  return `${instructions[type]}\n\n${text}`;
}

export function buildExplainPrompt(text: string, audience: "beginner" | "intermediate" | "expert" = "intermediate"): string {
  const levels: Record<string, string> = {
    beginner: "Explain this in simple terms, as if to someone with no technical background. Use analogies.",
    intermediate: "Explain this clearly, assuming familiarity with basic concepts.",
    expert: "Provide a thorough technical explanation with implementation details.",
  };
  return `${levels[audience]}\n\n${text}`;
}

export function buildReviewPrompt(code: string, language: string): string {
  return `Review this ${language} code for:\n1. Bugs and errors\n2. Security vulnerabilities\n3. Performance issues\n4. Code quality and best practices\n5. Suggestions for improvement\n\n\`\`\`${language}\n${code}\n\`\`\``;
}

export function buildDebugPrompt(error: string, context?: string): string {
  let prompt = `Debug this error. Explain what's wrong and suggest a fix.\n\nError:\n\`\`\`\n${error}\n\`\`\``;
  if (context) prompt += `\n\nContext:\n${context}`;
  return prompt;
}

// ── Model info ──────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  supportsVision: boolean;
  supportsTools: boolean;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-4-6", provider: "anthropic", name: "Claude Opus 4.6", contextWindow: 1000000, maxOutput: 32000, supportsVision: true, supportsTools: true, inputCostPer1M: 15, outputCostPer1M: 75 },
  { id: "claude-sonnet-4-20250514", provider: "anthropic", name: "Claude Sonnet 4", contextWindow: 200000, maxOutput: 16000, supportsVision: true, supportsTools: true, inputCostPer1M: 3, outputCostPer1M: 15 },
  { id: "claude-haiku-4-5-20251001", provider: "anthropic", name: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 8000, supportsVision: true, supportsTools: true, inputCostPer1M: 0.8, outputCostPer1M: 4 },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o", contextWindow: 128000, maxOutput: 16384, supportsVision: true, supportsTools: true, inputCostPer1M: 2.5, outputCostPer1M: 10 },
  { id: "gpt-4o-mini", provider: "openai", name: "GPT-4o Mini", contextWindow: 128000, maxOutput: 16384, supportsVision: true, supportsTools: true, inputCostPer1M: 0.15, outputCostPer1M: 0.6 },
  { id: "llama-3.3-70b-versatile", provider: "groq", name: "Llama 3.3 70B", contextWindow: 128000, maxOutput: 32000, supportsVision: false, supportsTools: true, inputCostPer1M: 0.59, outputCostPer1M: 0.79 },
  { id: "gemini-2.0-flash", provider: "gemini", name: "Gemini 2.0 Flash", contextWindow: 1000000, maxOutput: 8192, supportsVision: true, supportsTools: true, inputCostPer1M: 0.075, outputCostPer1M: 0.3 },
  { id: "gemini-2.5-pro-preview-06-05", provider: "gemini", name: "Gemini 2.5 Pro", contextWindow: 1000000, maxOutput: 65536, supportsVision: true, supportsTools: true, inputCostPer1M: 1.25, outputCostPer1M: 10 },
  { id: "llama3.2", provider: "ollama", name: "Llama 3.2 (local)", contextWindow: 8192, maxOutput: 4096, supportsVision: false, supportsTools: false, inputCostPer1M: 0, outputCostPer1M: 0 },
];

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === modelId);
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = getModelInfo(modelId);
  if (!model) return 0;
  return (inputTokens * model.inputCostPer1M + outputTokens * model.outputCostPer1M) / 1_000_000;
}

export function getModelsForProvider(provider: string): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function getBestModelForTask(task: "simple" | "code" | "creative" | "vision" | "long-context", budget: "low" | "medium" | "high" = "medium"): ModelInfo {
  const candidates = MODELS.filter((m) => {
    if (task === "vision" && !m.supportsVision) return false;
    if (task === "long-context" && m.contextWindow < 200000) return false;
    if (budget === "low" && m.inputCostPer1M > 1) return false;
    if (budget === "medium" && m.inputCostPer1M > 5) return false;
    return true;
  });

  if (candidates.length === 0) return MODELS[1]; // fallback to Sonnet

  // Sort by quality tier (higher cost = generally better)
  candidates.sort((a, b) => b.inputCostPer1M - a.inputCostPer1M);

  if (task === "simple") return candidates[candidates.length - 1]; // cheapest
  return candidates[0]; // best quality
}
