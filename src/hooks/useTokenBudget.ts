import { useMemo } from "react";

/**
 * Token Budget Manager — intelligent context window management.
 *
 * Problem: models have finite context windows (128k-1M tokens).
 * Naive approaches just truncate. Smart approaches COMPRESS.
 *
 * This hook assembles the optimal prompt from all available context:
 * - System prompt (brain.rs persona + context)
 * - SOUL.md (personality/identity)
 * - Learned patterns (feedback loop)
 * - Knowledge graph context (relevant entities)
 * - Compressed conversation history
 * - Memory entries (relevant facts)
 * - Conversation messages (recent, full)
 *
 * Each source has a priority and max budget. The manager fits
 * everything within the model's context window.
 */

export interface ContextSource {
  id: string;
  label: string;
  content: string;
  priority: number;         // 1 = highest priority, 10 = lowest
  maxTokens: number;        // max tokens to allocate
  estimatedTokens: number;  // actual token estimate
  compressible: boolean;    // can this be compressed further?
}

export interface TokenBudget {
  modelMaxTokens: number;
  reservedForResponse: number;
  availableForContext: number;
  sources: ContextSource[];
  totalUsed: number;
  utilization: number;      // 0-1
  warnings: string[];
}

// Rough token estimation: ~4 chars per token for English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Model context window sizes
const MODEL_CONTEXT: Record<string, number> = {
  // Anthropic
  "claude-sonnet-4-20250514": 200000,
  "claude-haiku-4-5-20251001": 200000,
  "claude-opus-4-6": 1000000,
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  // Groq
  "llama-3.3-70b-versatile": 128000,
  "llama-3.1-8b-instant": 128000,
  // Gemini
  "gemini-2.0-flash": 1000000,
  "gemini-2.5-pro-preview-06-05": 1000000,
  // Ollama (conservative)
  "llama3.2": 8192,
  "mistral": 32768,
};

const DEFAULT_CONTEXT = 128000;

interface TokenBudgetInput {
  model: string;
  systemPrompt: string;
  soulContext: string;
  learnedContext: string;
  knowledgeGraphContext: string;
  compressedHistory: string;
  memoryContext: string;
  conversationMessages: Array<{ role: string; content: string }>;
  responseReserve?: number; // tokens to reserve for response (default 4096)
}

export function useTokenBudget(input: TokenBudgetInput): TokenBudget {
  return useMemo(() => {
    const modelMax = MODEL_CONTEXT[input.model] || DEFAULT_CONTEXT;
    const responseReserve = input.responseReserve || 4096;
    const available = modelMax - responseReserve;
    const warnings: string[] = [];

    // Define sources with priorities
    const allSources: ContextSource[] = [
      {
        id: "system",
        label: "System Prompt",
        content: input.systemPrompt,
        priority: 1,
        maxTokens: 2000,
        estimatedTokens: estimateTokens(input.systemPrompt),
        compressible: false,
      },
      {
        id: "soul",
        label: "SOUL.md",
        content: input.soulContext,
        priority: 2,
        maxTokens: 1500,
        estimatedTokens: estimateTokens(input.soulContext),
        compressible: true,
      },
      {
        id: "learned",
        label: "Learned Patterns",
        content: input.learnedContext,
        priority: 3,
        maxTokens: 500,
        estimatedTokens: estimateTokens(input.learnedContext),
        compressible: true,
      },
      {
        id: "memory",
        label: "Relevant Memories",
        content: input.memoryContext,
        priority: 4,
        maxTokens: 800,
        estimatedTokens: estimateTokens(input.memoryContext),
        compressible: true,
      },
      {
        id: "knowledge",
        label: "Knowledge Graph",
        content: input.knowledgeGraphContext,
        priority: 5,
        maxTokens: 600,
        estimatedTokens: estimateTokens(input.knowledgeGraphContext),
        compressible: true,
      },
      {
        id: "compressed",
        label: "Past Context",
        content: input.compressedHistory,
        priority: 6,
        maxTokens: 1000,
        estimatedTokens: estimateTokens(input.compressedHistory),
        compressible: true,
      },
    ];

    // Conversation messages get remaining budget
    const contextTokensUsed = allSources.reduce((sum, s) => {
      const used = Math.min(s.estimatedTokens, s.maxTokens);
      return sum + (s.content ? used : 0);
    }, 0);

    const conversationBudget = available - contextTokensUsed;
    const conversationTokens = input.conversationMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content) + 10, // +10 for role/formatting overhead
      0,
    );

    // If conversation exceeds budget, truncate from beginning
    let truncatedMessages = input.conversationMessages;
    if (conversationTokens > conversationBudget) {
      let runningTokens = 0;
      const reversed = [...input.conversationMessages].reverse();
      const kept: typeof input.conversationMessages = [];

      for (const msg of reversed) {
        const msgTokens = estimateTokens(msg.content) + 10;
        if (runningTokens + msgTokens > conversationBudget) break;
        kept.unshift(msg);
        runningTokens += msgTokens;
      }

      truncatedMessages = kept;
      const dropped = input.conversationMessages.length - kept.length;
      if (dropped > 0) {
        warnings.push(`Truncated ${dropped} old messages to fit context window`);
      }
    }

    const conversationSource: ContextSource = {
      id: "conversation",
      label: "Conversation",
      content: truncatedMessages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      priority: 0, // highest — conversation is always included
      maxTokens: conversationBudget,
      estimatedTokens: Math.min(conversationTokens, conversationBudget),
      compressible: false,
    };

    const sources = [conversationSource, ...allSources.filter((s) => s.content.trim())];
    const totalUsed = sources.reduce((sum, s) => sum + Math.min(s.estimatedTokens, s.maxTokens), 0);

    if (totalUsed > available) {
      warnings.push(`Context exceeds budget: ${totalUsed} / ${available} tokens`);
    }

    if (totalUsed > modelMax * 0.9) {
      warnings.push("Approaching context window limit — consider starting a new conversation");
    }

    return {
      modelMaxTokens: modelMax,
      reservedForResponse: responseReserve,
      availableForContext: available,
      sources,
      totalUsed,
      utilization: totalUsed / available,
      warnings,
    };
  }, [input]);
}

export { estimateTokens, MODEL_CONTEXT };
