import { useMemo } from "react";

/**
 * AI Router — intelligent routing of user requests to the best
 * model/provider based on task type, complexity, and cost.
 *
 * Like a load balancer for AI models:
 * - Simple question → cheapest/fastest model
 * - Complex code → most capable model
 * - Vision → model with image support
 * - Long context → model with largest window
 * - Budget limit → stay within cost constraints
 */

export interface ModelCapability {
  provider: string;
  model: string;
  label: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kInput: number;     // $ per 1k input tokens
  costPer1kOutput: number;    // $ per 1k output tokens
  avgLatencyMs: number;       // typical first-token latency
  qualityTier: "economy" | "standard" | "premium" | "frontier";
  bestFor: string[];          // categories this model excels at
}

export interface RoutingDecision {
  provider: string;
  model: string;
  reason: string;
  alternatives: Array<{ provider: string; model: string; reason: string }>;
  estimatedCost: number;
  estimatedLatency: number;
}

export interface RoutingPreferences {
  preferSpeed: boolean;       // prefer faster models
  preferQuality: boolean;     // prefer highest quality
  preferCost: boolean;        // prefer cheapest
  maxCostPerRequest: number;  // $ limit per request
  preferredProvider: string | null;
  excludeProviders: string[];
  autoRoute: boolean;         // enable automatic routing
}

const MODEL_REGISTRY: ModelCapability[] = [
  // Anthropic
  {
    provider: "anthropic", model: "claude-opus-4-6", label: "Claude Opus 4.6",
    contextWindow: 1000000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.015, costPer1kOutput: 0.075, avgLatencyMs: 2000,
    qualityTier: "frontier", bestFor: ["complex-reasoning", "creative", "code-architecture", "analysis"],
  },
  {
    provider: "anthropic", model: "claude-sonnet-4-20250514", label: "Claude Sonnet 4",
    contextWindow: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.003, costPer1kOutput: 0.015, avgLatencyMs: 800,
    qualityTier: "premium", bestFor: ["code", "reasoning", "tools", "general"],
  },
  {
    provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",
    contextWindow: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.0008, costPer1kOutput: 0.004, avgLatencyMs: 300,
    qualityTier: "economy", bestFor: ["simple", "classification", "extraction", "fast"],
  },
  // OpenAI
  {
    provider: "openai", model: "gpt-4o", label: "GPT-4o",
    contextWindow: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.0025, costPer1kOutput: 0.01, avgLatencyMs: 600,
    qualityTier: "premium", bestFor: ["general", "code", "vision", "tools"],
  },
  {
    provider: "openai", model: "gpt-4o-mini", label: "GPT-4o Mini",
    contextWindow: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.00015, costPer1kOutput: 0.0006, avgLatencyMs: 300,
    qualityTier: "economy", bestFor: ["simple", "classification", "fast", "cheap"],
  },
  // Groq
  {
    provider: "groq", model: "llama-3.3-70b-versatile", label: "Llama 3.3 70B",
    contextWindow: 128000, supportsVision: false, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.00059, costPer1kOutput: 0.00079, avgLatencyMs: 150,
    qualityTier: "standard", bestFor: ["fast", "code", "general", "cheap"],
  },
  // Gemini
  {
    provider: "gemini", model: "gemini-2.0-flash", label: "Gemini 2.0 Flash",
    contextWindow: 1000000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.000075, costPer1kOutput: 0.0003, avgLatencyMs: 200,
    qualityTier: "economy", bestFor: ["fast", "long-context", "vision", "cheap"],
  },
  {
    provider: "gemini", model: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro",
    contextWindow: 1000000, supportsVision: true, supportsTools: true, supportsStreaming: true,
    costPer1kInput: 0.00125, costPer1kOutput: 0.01, avgLatencyMs: 1000,
    qualityTier: "premium", bestFor: ["code", "reasoning", "long-context", "analysis"],
  },
  // Ollama (free, local)
  {
    provider: "ollama", model: "llama3.2", label: "Llama 3.2 (local)",
    contextWindow: 8192, supportsVision: false, supportsTools: false, supportsStreaming: true,
    costPer1kInput: 0, costPer1kOutput: 0, avgLatencyMs: 500,
    qualityTier: "economy", bestFor: ["offline", "privacy", "simple"],
  },
];

// Task classification
function classifyTask(prompt: string, hasImage: boolean): string[] {
  const lower = prompt.toLowerCase();
  const categories: string[] = [];

  if (hasImage) categories.push("vision");
  if (lower.length > 5000) categories.push("long-context");

  const codeSignals = ["code", "function", "bug", "debug", "implement", "refactor", "test", "```", "error", "compile"];
  if (codeSignals.filter((s) => lower.includes(s)).length >= 2) categories.push("code");

  const reasonSignals = ["explain", "analyze", "compare", "why", "how does", "trade-off", "architecture", "design"];
  if (reasonSignals.filter((s) => lower.includes(s)).length >= 2) categories.push("reasoning");

  const creativeSignals = ["write", "draft", "story", "poem", "brainstorm", "creative", "compose"];
  if (creativeSignals.filter((s) => lower.includes(s)).length >= 2) categories.push("creative");

  const simpleSignals = lower.length < 50;
  if (simpleSignals && categories.length === 0) categories.push("simple");

  if (categories.length === 0) categories.push("general");

  return categories;
}

// Score a model for a given task
function scoreModel(
  model: ModelCapability,
  taskCategories: string[],
  preferences: RoutingPreferences,
  estimatedInputTokens: number,
): number {
  let score = 50; // base score

  // Task match bonus
  for (const cat of taskCategories) {
    if (model.bestFor.includes(cat)) score += 15;
  }

  // Vision requirement
  if (taskCategories.includes("vision") && !model.supportsVision) return 0;

  // Tool requirement
  if (taskCategories.includes("tools") && !model.supportsTools) return 0;

  // Context window check
  if (estimatedInputTokens > model.contextWindow * 0.8) return 0;

  // Preference adjustments
  if (preferences.preferSpeed) score += Math.max(0, 20 - model.avgLatencyMs / 100);
  if (preferences.preferQuality) {
    const tierScores = { frontier: 30, premium: 20, standard: 10, economy: 0 };
    score += tierScores[model.qualityTier];
  }
  if (preferences.preferCost) {
    const cost = (estimatedInputTokens * model.costPer1kInput) / 1000;
    score += Math.max(0, 20 - cost * 1000);
  }

  // Cost limit check
  const estimatedCost = (estimatedInputTokens * model.costPer1kInput) / 1000;
  if (preferences.maxCostPerRequest > 0 && estimatedCost > preferences.maxCostPerRequest) {
    score -= 50;
  }

  // Provider preference
  if (preferences.preferredProvider && model.provider === preferences.preferredProvider) score += 10;
  if (preferences.excludeProviders.includes(model.provider)) return 0;

  return score;
}

export function useAIRouter(preferences: RoutingPreferences) {
  const route = useMemo(() => {
    return (prompt: string, hasImage = false, estimatedTokens = 0): RoutingDecision => {
      const inputTokens = estimatedTokens || Math.ceil(prompt.length / 4);
      const taskCategories = classifyTask(prompt, hasImage);

      const scored = MODEL_REGISTRY
        .map((model) => ({
          model,
          score: scoreModel(model, taskCategories, preferences, inputTokens),
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        return {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          reason: "Fallback — no model matched criteria",
          alternatives: [],
          estimatedCost: 0,
          estimatedLatency: 800,
        };
      }

      const best = scored[0];
      const estimatedCost = (inputTokens * best.model.costPer1kInput) / 1000;

      return {
        provider: best.model.provider,
        model: best.model.model,
        reason: `Best for ${taskCategories.join(", ")} (score: ${best.score})`,
        alternatives: scored.slice(1, 4).map((s) => ({
          provider: s.model.provider,
          model: s.model.model,
          reason: `${s.model.label} (score: ${s.score})`,
        })),
        estimatedCost,
        estimatedLatency: best.model.avgLatencyMs,
      };
    };
  }, [preferences]);

  return {
    route,
    models: MODEL_REGISTRY,
    classifyTask,
  };
}
