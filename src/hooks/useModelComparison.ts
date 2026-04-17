import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BladeConfig } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonModel {
  provider: string;
  model: string;
  label: string;
}

export interface ModelResult {
  provider: string;
  model: string;
  content: string;
  responseTime: number; // ms
  error: string | null;
  wordCount: number;
  status: "pending" | "streaming" | "complete" | "error";
}

export interface ComparisonResult {
  id: string;
  prompt: string;
  timestamp: number;
  results: ModelResult[];
}

// ---------------------------------------------------------------------------
// Available models per provider
// ---------------------------------------------------------------------------

const AVAILABLE_MODELS: ComparisonModel[] = [
  // Groq
  { provider: "groq", model: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { provider: "groq", model: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
  { provider: "groq", model: "gemma2-9b-it", label: "Gemma2 9B" },
  // OpenAI
  { provider: "openai", model: "gpt-4o", label: "GPT-4o" },
  { provider: "openai", model: "gpt-4o-mini", label: "GPT-4o Mini" },
  { provider: "openai", model: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  // Anthropic
  { provider: "anthropic", model: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  // Gemini
  { provider: "gemini", model: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { provider: "gemini", model: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro" },
  // Ollama
  { provider: "ollama", model: "llama3.2", label: "Llama 3.2 (local)" },
  { provider: "ollama", model: "mistral", label: "Mistral (local)" },
  { provider: "ollama", model: "codellama", label: "Code Llama (local)" },
];

// ---------------------------------------------------------------------------
// Provider-specific fetch helpers
// ---------------------------------------------------------------------------

interface ProviderEndpoint {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, prompt: string) => string;
  extract: (json: unknown) => string;
}

const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    body: (model, prompt) =>
      JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      }),
    extract: (json: any) => json?.choices?.[0]?.message?.content ?? "",
  },

  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    }),
    body: (model, prompt) =>
      JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      }),
    extract: (json: any) => json?.choices?.[0]?.message?.content ?? "",
  },

  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }),
    body: (model, prompt) =>
      JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    extract: (json: any) => {
      const blocks = json?.content;
      if (Array.isArray(blocks)) {
        return blocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }
      return "";
    },
  },

  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    }),
    body: (_model, prompt) =>
      JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    extract: (json: any) =>
      json?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text)
        .join("") ?? "",
  },

  ollama: {
    url: "http://localhost:11434/api/chat",
    headers: () => ({ "Content-Type": "application/json" }),
    body: (model, prompt) =>
      JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    extract: (json: any) => json?.message?.content ?? "",
  },
};

// ---------------------------------------------------------------------------
// Fetch a single model response
// ---------------------------------------------------------------------------

async function fetchModelResponse(
  provider: string,
  model: string,
  prompt: string,
  apiKey: string
): Promise<{ content: string; responseTime: number }> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  let url = endpoint.url;
  if (provider === "gemini") {
    url = url.replace("{model}", model);
  }

  const start = performance.now();

  const response = await fetch(url, {
    method: "POST",
    headers: endpoint.headers(apiKey),
    body: endpoint.body(model, prompt),
  });

  const responseTime = Math.round(performance.now() - start);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      message =
        parsed?.error?.message ??
        parsed?.error?.type ??
        parsed?.message ??
        message;
    } catch {
      if (errorText.length < 200) message = errorText;
    }
    throw new Error(message);
  }

  const json = await response.json();
  const content = endpoint.extract(json);

  return { content, responseTime };
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "blade-comparisons";
const MAX_STORED = 10;

function loadStoredComparisons(): ComparisonResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveComparisons(items: ComparisonResult[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_STORED)));
  } catch {
    // Storage full — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useModelComparison() {
  const [results, setResults] = useState<ComparisonResult[]>(() =>
    loadStoredComparisons()
  );
  const [activeComparison, setActiveComparison] =
    useState<ComparisonResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runComparison = useCallback(
    async (prompt: string, models: ComparisonModel[]) => {
      // Cancel any in-flight comparison
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Get config for API key
      let config: BladeConfig;
      try {
        config = await invoke<BladeConfig>("get_config");
      } catch {
        throw new Error("Could not load Blade config");
      }

      const comparisonId = crypto.randomUUID();

      // Build initial result skeleton
      const comparison: ComparisonResult = {
        id: comparisonId,
        prompt,
        timestamp: Date.now(),
        results: models.map((m) => ({
          provider: m.provider,
          model: m.model,
          content: "",
          responseTime: 0,
          error: null,
          wordCount: 0,
          status: "pending",
        })),
      };

      setActiveComparison({ ...comparison });

      // Mark all as streaming
      comparison.results = comparison.results.map((r) => ({
        ...r,
        status: "streaming" as const,
      }));
      setActiveComparison({ ...comparison });

      // Fire all requests in parallel
      const promises = models.map(async (m, index) => {
        if (controller.signal.aborted) return;

        try {
          const { content, responseTime } = await fetchModelResponse(
            m.provider,
            m.model,
            prompt,
            config.api_key
          );

          if (controller.signal.aborted) return;

          const wordCount = content
            .split(/\s+/)
            .filter((w) => w.length > 0).length;

          comparison.results[index] = {
            ...comparison.results[index],
            content,
            responseTime,
            wordCount,
            status: "complete",
            error: null,
          };
        } catch (err) {
          if (controller.signal.aborted) return;

          comparison.results[index] = {
            ...comparison.results[index],
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }

        // Update live state after each model finishes
        setActiveComparison({ ...comparison, results: [...comparison.results] });
      });

      await Promise.allSettled(promises);

      if (controller.signal.aborted) return;

      // Mark comparison as fully done
      const finalComparison: ComparisonResult = {
        ...comparison,
        results: [...comparison.results],
      };
      setActiveComparison(finalComparison);

      // Persist to history
      setResults((prev) => {
        const next = [finalComparison, ...prev].slice(0, MAX_STORED);
        saveComparisons(next);
        return next;
      });

      return finalComparison;
    },
    []
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setActiveComparison(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    runComparison,
    results,
    activeComparison,
    clearResults,
    availableModels: AVAILABLE_MODELS,
  };
}
