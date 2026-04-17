import { useState, useCallback, useMemo } from "react";

/**
 * Cost Tracker — Real-time token cost estimation per agent run.
 *
 * Built because developers said:
 * "5-10x faster token burn with plugins"
 * "difficulty running multiple agents within usage limits"
 *
 * Tracks costs per provider, per model, per agent run.
 * Shows budget limits and warns before overspending.
 */

export interface CostEntry {
  id: string;
  source: "chat" | "agent" | "tool" | "embedding" | "tts" | "stt";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
  agentRunId?: string;
  sessionId?: string;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costByProvider: Record<string, number>;
  costBySource: Record<string, number>;
  costByModel: Record<string, number>;
  costToday: number;
  costThisWeek: number;
  costThisMonth: number;
  entries: CostEntry[];
}

export interface CostBudget {
  dailyLimitUsd: number;
  weeklyLimitUsd: number;
  monthlyLimitUsd: number;
  alertAtPercent: number; // 0-100, warn when budget reaches this %
}

// Pricing per 1M tokens (approximate, mid-2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  // OpenAI
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  // Groq (approximate)
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  // Gemini
  "gemini-2.0-flash": { input: 0.075, output: 0.30 },
  "gemini-2.5-pro-preview-06-05": { input: 1.25, output: 10.0 },
  // Ollama (free)
  "llama3.2": { input: 0, output: 0 },
  "mistral": { input: 0, output: 0 },
};

const STORAGE_KEY = "blade-costs";
const BUDGET_KEY = "blade-cost-budget";
const MAX_ENTRIES = 1000;

const DEFAULT_BUDGET: CostBudget = {
  dailyLimitUsd: 5.0,
  weeklyLimitUsd: 25.0,
  monthlyLimitUsd: 100.0,
  alertAtPercent: 80,
};

function loadEntries(): CostEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveEntries(entries: CostEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

function loadBudget(): CostBudget {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    return raw ? { ...DEFAULT_BUDGET, ...JSON.parse(raw) } : DEFAULT_BUDGET;
  } catch {
    return DEFAULT_BUDGET;
  }
}

function saveBudget(budget: CostBudget) {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Monday
  return d.getTime();
}

function startOfMonth(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useCostTracker() {
  const [entries, setEntries] = useState<CostEntry[]>(loadEntries);
  const [budget, setBudget] = useState<CostBudget>(loadBudget);

  const trackCost = useCallback((entry: Omit<CostEntry, "id" | "timestamp" | "costUsd">) => {
    const costUsd = estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
    const full: CostEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      costUsd,
    };
    setEntries((prev) => {
      const next = [...prev, full].slice(-MAX_ENTRIES);
      saveEntries(next);
      return next;
    });
    return costUsd;
  }, []);

  const updateBudget = useCallback((updates: Partial<CostBudget>) => {
    setBudget((prev) => {
      const next = { ...prev, ...updates };
      saveBudget(next);
      return next;
    });
  }, []);

  const summary = useMemo((): CostSummary => {
    const todayStart = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    const costByProvider: Record<string, number> = {};
    const costBySource: Record<string, number> = {};
    const costByModel: Record<string, number> = {};
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let costToday = 0;
    let costWeek = 0;
    let costMonth = 0;

    for (const e of entries) {
      totalCost += e.costUsd;
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;
      costByProvider[e.provider] = (costByProvider[e.provider] || 0) + e.costUsd;
      costBySource[e.source] = (costBySource[e.source] || 0) + e.costUsd;
      costByModel[e.model] = (costByModel[e.model] || 0) + e.costUsd;
      if (e.timestamp >= todayStart) costToday += e.costUsd;
      if (e.timestamp >= weekStart) costWeek += e.costUsd;
      if (e.timestamp >= monthStart) costMonth += e.costUsd;
    }

    return {
      totalCostUsd: totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      costByProvider,
      costBySource,
      costByModel,
      costToday,
      costThisWeek: costWeek,
      costThisMonth: costMonth,
      entries,
    };
  }, [entries]);

  const budgetWarning = useMemo((): string | null => {
    const { costToday, costThisWeek, costThisMonth } = summary;
    const threshold = budget.alertAtPercent / 100;

    if (costToday >= budget.dailyLimitUsd) return `Daily budget exceeded: $${costToday.toFixed(2)}/$${budget.dailyLimitUsd}`;
    if (costThisWeek >= budget.weeklyLimitUsd) return `Weekly budget exceeded: $${costThisWeek.toFixed(2)}/$${budget.weeklyLimitUsd}`;
    if (costThisMonth >= budget.monthlyLimitUsd) return `Monthly budget exceeded: $${costThisMonth.toFixed(2)}/$${budget.monthlyLimitUsd}`;

    if (costToday >= budget.dailyLimitUsd * threshold) return `Daily budget at ${Math.round((costToday / budget.dailyLimitUsd) * 100)}%`;
    if (costThisWeek >= budget.weeklyLimitUsd * threshold) return `Weekly budget at ${Math.round((costThisWeek / budget.weeklyLimitUsd) * 100)}%`;
    if (costThisMonth >= budget.monthlyLimitUsd * threshold) return `Monthly budget at ${Math.round((costThisMonth / budget.monthlyLimitUsd) * 100)}%`;

    return null;
  }, [summary, budget]);

  const clearHistory = useCallback(() => {
    setEntries([]);
    saveEntries([]);
  }, []);

  return {
    trackCost,
    summary,
    budget,
    updateBudget,
    budgetWarning,
    clearHistory,
    estimateCost,
    modelPricing: MODEL_PRICING,
  };
}
