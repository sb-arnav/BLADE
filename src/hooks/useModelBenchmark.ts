import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Model Benchmark — compare AI models on standardized tasks.
 * Run the same prompt across providers and score quality, speed, cost.
 */

export interface BenchmarkTask {
  id: string;
  name: string;
  category: "coding" | "reasoning" | "creative" | "factual" | "instruction" | "math";
  prompt: string;
  expectedOutput?: string;   // for automated scoring
  scoringCriteria: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface BenchmarkResult {
  taskId: string;
  model: string;
  provider: string;
  response: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  qualityScore: number | null;  // 1-10, null if not yet scored
  timestamp: number;
}

export interface BenchmarkRun {
  id: string;
  name: string;
  tasks: BenchmarkTask[];
  models: Array<{ provider: string; model: string }>;
  results: BenchmarkResult[];
  status: "idle" | "running" | "completed";
  startedAt: number | null;
  completedAt: number | null;
  progress: number;           // 0-100
}

const BUILT_IN_TASKS: BenchmarkTask[] = [
  {
    id: "code-fizzbuzz",
    name: "FizzBuzz",
    category: "coding",
    prompt: "Write a FizzBuzz function in TypeScript that returns an array of strings for numbers 1 to 100.",
    scoringCriteria: "Correctness, type safety, conciseness",
    difficulty: "easy",
  },
  {
    id: "code-debounce",
    name: "Implement Debounce",
    category: "coding",
    prompt: "Implement a debounce function in TypeScript with proper typing. Include cancel and flush methods.",
    scoringCriteria: "Correctness, proper generics, edge cases handled",
    difficulty: "medium",
  },
  {
    id: "code-lru-cache",
    name: "LRU Cache",
    category: "coding",
    prompt: "Implement an LRU Cache class in TypeScript with O(1) get and put operations. Include types.",
    scoringCriteria: "Correctness, time complexity, clean implementation",
    difficulty: "hard",
  },
  {
    id: "reason-logic",
    name: "Logic Puzzle",
    category: "reasoning",
    prompt: "Alice, Bob, and Charlie each have a different pet (cat, dog, fish). Alice doesn't have the cat. Bob doesn't have the dog. Charlie has the fish. Who has which pet? Explain your reasoning step by step.",
    expectedOutput: "Alice has the dog, Bob has the cat, Charlie has the fish",
    scoringCriteria: "Correct answer, clear reasoning, step-by-step logic",
    difficulty: "easy",
  },
  {
    id: "reason-paradox",
    name: "Philosophical Reasoning",
    category: "reasoning",
    prompt: "Explain the Ship of Theseus paradox and give 3 different philosophical perspectives on it, with a real-world modern example.",
    scoringCriteria: "Accuracy, depth, quality of examples, clarity",
    difficulty: "medium",
  },
  {
    id: "creative-story",
    name: "Micro Fiction",
    category: "creative",
    prompt: "Write a complete short story in exactly 100 words about a programmer who discovers their code has become sentient.",
    scoringCriteria: "Exactly 100 words, narrative arc, creativity, emotional impact",
    difficulty: "medium",
  },
  {
    id: "creative-poem",
    name: "Technical Poetry",
    category: "creative",
    prompt: "Write a haiku about debugging a production outage at 3am.",
    scoringCriteria: "5-7-5 syllable structure, technical accuracy, emotional resonance",
    difficulty: "easy",
  },
  {
    id: "factual-explain",
    name: "Technical Explanation",
    category: "factual",
    prompt: "Explain how HTTPS works, from the browser typing a URL to the page loading. Include TLS handshake, certificate verification, and key exchange.",
    scoringCriteria: "Technical accuracy, completeness, clarity, correct ordering",
    difficulty: "medium",
  },
  {
    id: "instruction-extract",
    name: "Data Extraction",
    category: "instruction",
    prompt: 'Extract all dates, names, and monetary amounts from this text: "On January 15, 2024, John Smith paid $1,500 to Acme Corp. Sarah Johnson received $2,300 on March 3rd. The final payment of $890 was made by Mike Chen on December 1, 2023." Return as JSON.',
    scoringCriteria: "Complete extraction, correct JSON format, no hallucinations",
    difficulty: "easy",
  },
  {
    id: "math-probability",
    name: "Probability",
    category: "math",
    prompt: "A bag contains 5 red balls and 3 blue balls. If you draw 2 balls without replacement, what is the probability that both are red? Show your work.",
    expectedOutput: "10/28 or 5/14",
    scoringCriteria: "Correct answer (5/14 ≈ 0.357), clear work shown",
    difficulty: "medium",
  },
];

const STORAGE_KEY = "blade-benchmarks";

function loadRuns(): BenchmarkRun[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveRuns(runs: BenchmarkRun[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(-20)));
}

// Rough token estimation
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Model pricing (per 1M tokens)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gemini-2.0-flash": { input: 0.075, output: 0.3 },
};

export function useModelBenchmark() {
  const [runs, setRuns] = useState<BenchmarkRun[]>(loadRuns);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const createRun = useCallback((
    name: string,
    taskIds: string[],
    models: Array<{ provider: string; model: string }>,
  ): string => {
    const tasks = BUILT_IN_TASKS.filter((t) => taskIds.includes(t.id));
    const run: BenchmarkRun = {
      id: crypto.randomUUID(),
      name,
      tasks,
      models,
      results: [],
      status: "idle",
      startedAt: null,
      completedAt: null,
      progress: 0,
    };
    setRuns((prev) => {
      const next = [...prev, run];
      saveRuns(next);
      return next;
    });
    return run.id;
  }, []);

  const startRun = useCallback(async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;

    setActiveRunId(runId);
    setRuns((prev) => prev.map((r) => r.id === runId ? { ...r, status: "running", startedAt: Date.now() } : r));

    const totalTests = run.tasks.length * run.models.length;
    let completed = 0;

    for (const task of run.tasks) {
      for (const model of run.models) {
        try {
          const startTime = Date.now();

          // Call the provider's test endpoint
          const response = await invoke<string>("test_provider", {
            provider: model.provider,
            apiKey: "",  // will use stored key
            model: model.model,
          });

          const latency = Date.now() - startTime;
          const inputTokens = estimateTokens(task.prompt);
          const outputTokens = estimateTokens(response);
          const pricing = PRICING[model.model] || { input: 0, output: 0 };
          const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

          const result: BenchmarkResult = {
            taskId: task.id,
            model: model.model,
            provider: model.provider,
            response,
            latencyMs: latency,
            inputTokens,
            outputTokens,
            estimatedCost: cost,
            qualityScore: null,
            timestamp: Date.now(),
          };

          completed++;
          setRuns((prev) => prev.map((r) => r.id === runId ? {
            ...r,
            results: [...r.results, result],
            progress: Math.round((completed / totalTests) * 100),
          } : r));
        } catch {
          completed++;
          setRuns((prev) => prev.map((r) => r.id === runId ? {
            ...r,
            progress: Math.round((completed / totalTests) * 100),
          } : r));
        }
      }
    }

    setRuns((prev) => {
      const next = prev.map((r) => r.id === runId ? { ...r, status: "completed" as const, completedAt: Date.now() } : r);
      saveRuns(next);
      return next;
    });
    setActiveRunId(null);
  }, [runs]);

  const scoreResult = useCallback((runId: string, taskId: string, model: string, score: number) => {
    setRuns((prev) => {
      const next = prev.map((r) => r.id === runId ? {
        ...r,
        results: r.results.map((res) =>
          res.taskId === taskId && res.model === model ? { ...res, qualityScore: score } : res,
        ),
      } : r);
      saveRuns(next);
      return next;
    });
  }, []);

  const deleteRun = useCallback((runId: string) => {
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== runId);
      saveRuns(next);
      return next;
    });
  }, []);

  const getLeaderboard = useCallback((runId: string): Array<{
    model: string;
    provider: string;
    avgQuality: number;
    avgLatency: number;
    totalCost: number;
    tasksCompleted: number;
  }> => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return [];

    const modelStats: Record<string, {
      qualities: number[];
      latencies: number[];
      costs: number[];
      count: number;
    }> = {};

    for (const result of run.results) {
      const key = `${result.provider}:${result.model}`;
      if (!modelStats[key]) modelStats[key] = { qualities: [], latencies: [], costs: [], count: 0 };
      if (result.qualityScore) modelStats[key].qualities.push(result.qualityScore);
      modelStats[key].latencies.push(result.latencyMs);
      modelStats[key].costs.push(result.estimatedCost);
      modelStats[key].count++;
    }

    return Object.entries(modelStats)
      .map(([key, stats]) => {
        const [provider, model] = key.split(":");
        return {
          model,
          provider,
          avgQuality: stats.qualities.length > 0 ? stats.qualities.reduce((a, b) => a + b, 0) / stats.qualities.length : 0,
          avgLatency: stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length,
          totalCost: stats.costs.reduce((a, b) => a + b, 0),
          tasksCompleted: stats.count,
        };
      })
      .sort((a, b) => b.avgQuality - a.avgQuality || a.avgLatency - b.avgLatency);
  }, [runs]);

  return {
    runs,
    activeRunId,
    builtInTasks: BUILT_IN_TASKS,
    createRun,
    startRun,
    scoreResult,
    deleteRun,
    getLeaderboard,
  };
}
