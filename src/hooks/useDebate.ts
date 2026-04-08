import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BladeConfig } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebatePosition {
  id: string;
  perspective: string;
  arguments: string[];
  counterarguments: string[];
  evidence: string[];
  strength: number; // 0-100
}

export interface Debate {
  id: string;
  topic: string;
  frameworkId: string;
  positions: DebatePosition[];
  summary: string | null;
  winner: string | null;
  status: "setup" | "arguing" | "summarizing" | "completed";
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisFramework {
  id: string;
  name: string;
  icon: string;
  description: string;
  perspectives: string[];
  promptTemplate: string;
}

// ---------------------------------------------------------------------------
// Built-in analysis frameworks
// ---------------------------------------------------------------------------

const FRAMEWORKS: AnalysisFramework[] = [
  {
    id: "pro-con",
    name: "Pro vs Con",
    icon: "scale",
    description: "Simple binary debate weighing arguments for and against",
    perspectives: ["Pro (In Favor)", "Con (Against)"],
    promptTemplate:
      "Analyze the following topic from a {perspective} standpoint. Topic: {topic}\n\nProvide 3-5 strong arguments. Be specific, cite reasoning, and rate the strength of each argument. Format each argument on its own line prefixed with a dash (-).",
  },
  {
    id: "swot",
    name: "SWOT Analysis",
    icon: "grid",
    description: "Strengths, Weaknesses, Opportunities, Threats",
    perspectives: ["Strengths", "Weaknesses", "Opportunities", "Threats"],
    promptTemplate:
      "Perform a SWOT analysis on the following topic, focusing exclusively on the {perspective} dimension. Topic: {topic}\n\nList 3-5 specific points. Be concrete, provide evidence or reasoning, and rate relative importance. Format each point on its own line prefixed with a dash (-).",
  },
  {
    id: "six-hats",
    name: "Six Thinking Hats",
    icon: "hat",
    description: "de Bono's six perspectives: facts, emotions, caution, optimism, creativity, process",
    perspectives: [
      "White Hat (Facts & Data)",
      "Red Hat (Emotions & Intuition)",
      "Black Hat (Caution & Risks)",
      "Yellow Hat (Optimism & Benefits)",
      "Green Hat (Creativity & Alternatives)",
      "Blue Hat (Process & Overview)",
    ],
    promptTemplate:
      "Using de Bono's Six Thinking Hats method, analyze from the {perspective} perspective. Topic: {topic}\n\nProvide 3-5 key points from this thinking mode. Stay strictly in character for this hat color. Format each point on its own line prefixed with a dash (-).",
  },
  {
    id: "devils-advocate",
    name: "Devil's Advocate",
    icon: "flame",
    description: "Best case, worst case, and most likely scenario analysis",
    perspectives: ["Best Case Scenario", "Worst Case Scenario", "Most Likely Scenario"],
    promptTemplate:
      "Analyze the following topic from the perspective of the {perspective}. Topic: {topic}\n\nDescribe what happens in this scenario with 3-5 concrete arguments and outcomes. Be vivid and specific. Format each point on its own line prefixed with a dash (-).",
  },
  {
    id: "stakeholder",
    name: "Stakeholder Analysis",
    icon: "users",
    description: "Analyze from user, developer, business, and investor viewpoints",
    perspectives: ["End User", "Developer / Engineer", "Business / Management", "Investor / Board"],
    promptTemplate:
      "Analyze the following topic from the perspective of the {perspective} stakeholder group. Topic: {topic}\n\nWhat are their 3-5 primary concerns, benefits, and risks? Be specific about impact and priorities. Format each point on its own line prefixed with a dash (-).",
  },
  {
    id: "risk-assessment",
    name: "Risk Assessment",
    icon: "shield",
    description: "Evaluate probability vs impact across risk categories",
    perspectives: [
      "High Probability / High Impact",
      "High Probability / Low Impact",
      "Low Probability / High Impact",
      "Low Probability / Low Impact",
    ],
    promptTemplate:
      "Perform a risk assessment on the following topic, focusing on the {perspective} quadrant. Topic: {topic}\n\nIdentify 3-5 risks or outcomes that fall into this category. Explain why each belongs here and suggest mitigations. Format each point on its own line prefixed with a dash (-).",
  },
  {
    id: "first-principles",
    name: "First Principles",
    icon: "atom",
    description: "Break down to fundamentals, challenge assumptions, rebuild",
    perspectives: [
      "Fundamental Assumptions",
      "Core Components",
      "Rebuilt from Scratch",
    ],
    promptTemplate:
      "Apply first-principles thinking to the following topic, focusing on: {perspective}. Topic: {topic}\n\nIf analyzing assumptions, identify and challenge each one. If analyzing components, break down to irreducible parts. If rebuilding, propose a novel approach from the ground up. Provide 3-5 points. Format each on its own line prefixed with a dash (-).",
  },
  {
    id: "historical-parallel",
    name: "Historical Parallel",
    icon: "clock",
    description: "Find 3 historical analogies and extract lessons",
    perspectives: [
      "Historical Parallel #1",
      "Historical Parallel #2",
      "Historical Parallel #3",
    ],
    promptTemplate:
      "Find a unique historical analogy for the following topic. This is {perspective} — choose a different era or domain than other parallels. Topic: {topic}\n\nDescribe the historical event or pattern, explain how it maps to the current topic, and extract 2-3 specific lessons. Format each point on its own line prefixed with a dash (-).",
  },
];

// ---------------------------------------------------------------------------
// Provider-specific fetch (reuse same pattern as useModelComparison)
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

async function callLLM(
  provider: string,
  model: string,
  apiKey: string,
  prompt: string
): Promise<string> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) throw new Error(`Unknown provider: ${provider}`);

  let url = endpoint.url;
  if (provider === "gemini") {
    url = url.replace("{model}", model);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: endpoint.headers(apiKey),
    body: endpoint.body(model, prompt),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed?.error?.message ?? parsed?.message ?? message;
    } catch {
      if (errorText.length < 200) message = errorText;
    }
    throw new Error(message);
  }

  const json = await response.json();
  return endpoint.extract(json);
}

// ---------------------------------------------------------------------------
// Parse AI response into argument lines
// ---------------------------------------------------------------------------

function parseArgumentLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("*") || /^\d+[\.\)]/.test(line))
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((line) => line.length > 10);
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "blade-debates";
const MAX_STORED = 20;

function loadStoredDebates(): Debate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDebates(debates: Debate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(debates.slice(0, MAX_STORED)));
  } catch {
    // Storage full — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDebate() {
  const [debates, setDebates] = useState<Debate[]>(() => loadStoredDebates());
  const [activeDebate, setActiveDebate] = useState<Debate | null>(null);
  const [generating, setGenerating] = useState(false);

  // ---- persist helper ----
  const persist = useCallback((updated: Debate, allDebates: Debate[]) => {
    const idx = allDebates.findIndex((d) => d.id === updated.id);
    let next: Debate[];
    if (idx >= 0) {
      next = [...allDebates];
      next[idx] = updated;
    } else {
      next = [updated, ...allDebates];
    }
    saveDebates(next);
    return next;
  }, []);

  // ---- create debate ----
  const createDebate = useCallback(
    (topic: string, frameworkId: string): Debate => {
      const framework = FRAMEWORKS.find((f) => f.id === frameworkId);
      if (!framework) throw new Error(`Unknown framework: ${frameworkId}`);

      const now = Date.now();
      const debate: Debate = {
        id: crypto.randomUUID(),
        topic,
        frameworkId,
        positions: framework.perspectives.map((perspective) => ({
          id: crypto.randomUUID(),
          perspective,
          arguments: [],
          counterarguments: [],
          evidence: [],
          strength: 0,
        })),
        summary: null,
        winner: null,
        status: "setup",
        createdAt: now,
        updatedAt: now,
      };

      setActiveDebate(debate);
      setDebates((prev) => {
        const next = persist(debate, prev);
        return next;
      });

      return debate;
    },
    [persist]
  );

  // ---- add custom position ----
  const addPosition = useCallback(
    (debateId: string, perspective: string) => {
      setActiveDebate((prev) => {
        if (!prev || prev.id !== debateId) return prev;
        const updated: Debate = {
          ...prev,
          positions: [
            ...prev.positions,
            {
              id: crypto.randomUUID(),
              perspective,
              arguments: [],
              counterarguments: [],
              evidence: [],
              strength: 0,
            },
          ],
          updatedAt: Date.now(),
        };
        setDebates((all) => persist(updated, all));
        return updated;
      });
    },
    [persist]
  );

  // ---- generate arguments for a position ----
  const generateArguments = useCallback(
    async (debateId: string, positionId: string) => {
      setGenerating(true);
      try {
        const config = await invoke<BladeConfig>("get_config");
        const debate = debates.find((d) => d.id === debateId) ?? activeDebate;
        if (!debate) throw new Error("Debate not found");

        const framework = FRAMEWORKS.find((f) => f.id === debate.frameworkId);
        const position = debate.positions.find((p) => p.id === positionId);
        if (!position) throw new Error("Position not found");

        const prompt = (framework?.promptTemplate ?? "Analyze {topic} from the {perspective} perspective. Provide 3-5 arguments, each on its own line prefixed with a dash (-).")
          .replace("{perspective}", position.perspective)
          .replace("{topic}", debate.topic);

        const raw = await callLLM(config.provider, config.model, config.api_key, prompt);
        const args = parseArgumentLines(raw);
        const strength = Math.min(100, Math.max(10, args.length * 20 + Math.floor(Math.random() * 15)));

        const updated: Debate = {
          ...debate,
          status: "arguing",
          positions: debate.positions.map((p) =>
            p.id === positionId
              ? { ...p, arguments: args.length > 0 ? args : [raw.trim()], strength }
              : p
          ),
          updatedAt: Date.now(),
        };

        setActiveDebate(updated);
        setDebates((all) => persist(updated, all));
      } finally {
        setGenerating(false);
      }
    },
    [debates, activeDebate, persist]
  );

  // ---- generate counterarguments for a position ----
  const generateCounterarguments = useCallback(
    async (debateId: string, positionId: string) => {
      setGenerating(true);
      try {
        const config = await invoke<BladeConfig>("get_config");
        const debate = debates.find((d) => d.id === debateId) ?? activeDebate;
        if (!debate) throw new Error("Debate not found");

        const position = debate.positions.find((p) => p.id === positionId);
        if (!position) throw new Error("Position not found");

        const otherArgs = debate.positions
          .filter((p) => p.id !== positionId)
          .flatMap((p) => p.arguments)
          .join("\n- ");

        const prompt = `Given the topic: "${debate.topic}"

The "${position.perspective}" position argues:
- ${position.arguments.join("\n- ")}

Other perspectives argue:
- ${otherArgs || "No other arguments yet."}

Generate 3-5 strong counterarguments against the "${position.perspective}" position. Be specific and reference the actual arguments made. Format each counterargument on its own line prefixed with a dash (-).`;

        const raw = await callLLM(config.provider, config.model, config.api_key, prompt);
        const counters = parseArgumentLines(raw);

        const updated: Debate = {
          ...debate,
          positions: debate.positions.map((p) =>
            p.id === positionId
              ? {
                  ...p,
                  counterarguments: counters.length > 0 ? counters : [raw.trim()],
                  strength: Math.max(5, p.strength - Math.floor(counters.length * 5)),
                }
              : p
          ),
          updatedAt: Date.now(),
        };

        setActiveDebate(updated);
        setDebates((all) => persist(updated, all));
      } finally {
        setGenerating(false);
      }
    },
    [debates, activeDebate, persist]
  );

  // ---- generate overall summary ----
  const generateSummary = useCallback(
    async (debateId: string) => {
      setGenerating(true);
      try {
        const config = await invoke<BladeConfig>("get_config");
        const debate = debates.find((d) => d.id === debateId) ?? activeDebate;
        if (!debate) throw new Error("Debate not found");

        const framework = FRAMEWORKS.find((f) => f.id === debate.frameworkId);

        const positionSummaries = debate.positions
          .map(
            (p) =>
              `## ${p.perspective} (strength: ${p.strength}/100)\nArguments:\n- ${p.arguments.join("\n- ")}\nCounterarguments:\n- ${p.counterarguments.join("\n- ") || "None yet"}`
          )
          .join("\n\n");

        const prompt = `You are an impartial analyst. A "${framework?.name ?? "multi-perspective"}" analysis was conducted on the topic: "${debate.topic}"

Here are all positions and their arguments:

${positionSummaries}

Provide a comprehensive summary that includes:
1. An overall assessment of the debate (2-3 sentences)
2. The strongest position and why
3. The weakest position and why
4. 3-5 key insights or takeaways
5. A final recommendation or conclusion

Be balanced, specific, and reference actual arguments made.`;

        const raw = await callLLM(config.provider, config.model, config.api_key, prompt);

        // Try to detect winner from summary
        let winner: string | null = null;
        const strongestMatch = raw.match(/strongest.*?(?:is|position|:)\s*["']?([^"'\n.]+)/i);
        if (strongestMatch) {
          const candidate = strongestMatch[1].trim();
          const matched = debate.positions.find(
            (p) =>
              p.perspective.toLowerCase().includes(candidate.toLowerCase()) ||
              candidate.toLowerCase().includes(p.perspective.toLowerCase())
          );
          if (matched) winner = matched.perspective;
        }
        // Fallback: highest strength
        if (!winner) {
          const sorted = [...debate.positions].sort((a, b) => b.strength - a.strength);
          if (sorted.length > 0 && sorted[0].strength > 0) {
            winner = sorted[0].perspective;
          }
        }

        const updated: Debate = {
          ...debate,
          summary: raw,
          winner,
          status: "completed",
          updatedAt: Date.now(),
        };

        setActiveDebate(updated);
        setDebates((all) => persist(updated, all));
      } finally {
        setGenerating(false);
      }
    },
    [debates, activeDebate, persist]
  );

  // ---- start debate (generate all arguments in parallel) ----
  const startDebate = useCallback(
    async (debateId: string) => {
      setGenerating(true);
      try {
        const config = await invoke<BladeConfig>("get_config");
        let debate = debates.find((d) => d.id === debateId) ?? activeDebate;
        if (!debate) throw new Error("Debate not found");

        const framework = FRAMEWORKS.find((f) => f.id === debate.frameworkId);

        // Update status to arguing
        debate = { ...debate, status: "arguing", updatedAt: Date.now() };
        setActiveDebate(debate);

        // Generate arguments for all positions in parallel
        const results = await Promise.allSettled(
          debate.positions.map(async (position) => {
            const prompt = (framework?.promptTemplate ?? "Analyze {topic} from the {perspective} perspective. Provide 3-5 arguments, each on its own line prefixed with a dash (-).")
              .replace("{perspective}", position.perspective)
              .replace("{topic}", debate!.topic);

            const raw = await callLLM(config.provider, config.model, config.api_key, prompt);
            const args = parseArgumentLines(raw);
            const strength = Math.min(100, Math.max(10, args.length * 20 + Math.floor(Math.random() * 15)));

            return {
              positionId: position.id,
              arguments: args.length > 0 ? args : [raw.trim()],
              strength,
            };
          })
        );

        // Apply results
        const updatedPositions = debate.positions.map((p) => {
          const result = results.find(
            (r) => r.status === "fulfilled" && r.value.positionId === p.id
          );
          if (result && result.status === "fulfilled") {
            return {
              ...p,
              arguments: result.value.arguments,
              strength: result.value.strength,
            };
          }
          return p;
        });

        const updated: Debate = {
          ...debate,
          positions: updatedPositions,
          status: "arguing",
          updatedAt: Date.now(),
        };

        setActiveDebate(updated);
        setDebates((all) => persist(updated, all));
      } finally {
        setGenerating(false);
      }
    },
    [debates, activeDebate, persist]
  );

  // ---- load a past debate ----
  const loadDebate = useCallback(
    (debateId: string) => {
      const found = debates.find((d) => d.id === debateId);
      if (found) setActiveDebate(found);
    },
    [debates]
  );

  // ---- delete a debate ----
  const deleteDebate = useCallback(
    (debateId: string) => {
      setDebates((prev) => {
        const next = prev.filter((d) => d.id !== debateId);
        saveDebates(next);
        return next;
      });
      if (activeDebate?.id === debateId) setActiveDebate(null);
    },
    [activeDebate]
  );

  // ---- clear active debate ----
  const clearActive = useCallback(() => {
    setActiveDebate(null);
  }, []);

  return {
    debates,
    activeDebate,
    generating,
    createDebate,
    addPosition,
    generateArguments,
    generateCounterarguments,
    generateSummary,
    startDebate,
    loadDebate,
    deleteDebate,
    clearActive,
    frameworks: FRAMEWORKS,
  };
}
