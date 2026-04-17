import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MissionSpec, OperatorMission } from "../types";
import { specToOperatorMission } from "../lib/missionSpec";
import { addMemory } from "../data/characterBible";

/**
 * Self-Evolution System — Hermes/Letta-inspired.
 *
 * Blade watches its own actions, creates new skills from experience,
 * self-optimizes prompts, and builds a deepening model of the user.
 *
 * Three core capabilities:
 * 1. Skill Generation — when Blade repeatedly does something, it crystallizes
 *    into a reusable skill (like a macro that gets smarter)
 * 2. Prompt Optimization — track which prompt patterns get positive feedback,
 *    auto-adjust system prompts over time
 * 3. Context Compression — Letta-style recursive summarization that preserves
 *    meaning while reducing tokens
 */

export interface GeneratedSkill {
  id: string;
  name: string;
  trigger: string;          // what user input triggers this skill
  template: string;         // the optimized prompt template
  exampleInputs: string[];  // real inputs that led to this skill
  successRate: number;       // 0-1 based on feedback
  usageCount: number;
  createdAt: number;
  updatedAt: number;
  generatedFrom: string;    // conversation IDs that spawned this
  active: boolean;
}

export interface PromptOptimization {
  id: string;
  original: string;
  optimized: string;
  improvement: number;      // % improvement in positive feedback
  appliedAt: number;
  revertable: boolean;
}

export interface CompressedContext {
  id: string;
  originalTokens: number;
  compressedTokens: number;
  summary: string;
  keyFacts: string[];
  conversationIds: string[];
  createdAt: number;
  compressionRatio: number;
}

const SKILLS_KEY = "blade-evolved-skills";
const OPTIMIZATIONS_KEY = "blade-prompt-opts";
const COMPRESSED_KEY = "blade-compressed-contexts";

function loadSkills(): GeneratedSkill[] {
  try { return JSON.parse(localStorage.getItem(SKILLS_KEY) || "[]"); }
  catch { return []; }
}

function saveSkills(skills: GeneratedSkill[]) {
  localStorage.setItem(SKILLS_KEY, JSON.stringify(skills));
}

function loadOptimizations(): PromptOptimization[] {
  try { return JSON.parse(localStorage.getItem(OPTIMIZATIONS_KEY) || "[]"); }
  catch { return []; }
}

// Prompt optimization saving — will be enabled when optimization loop is active
void OPTIMIZATIONS_KEY;

function loadCompressed(): CompressedContext[] {
  try { return JSON.parse(localStorage.getItem(COMPRESSED_KEY) || "[]"); }
  catch { return []; }
}

function saveCompressed(contexts: CompressedContext[]) {
  localStorage.setItem(COMPRESSED_KEY, JSON.stringify(contexts));
}

// Detect repeating patterns in user prompts
function detectPatterns(prompts: string[]): Array<{ pattern: string; count: number; examples: string[] }> {
  const normalized = prompts.map((p) => {
    // Normalize: lowercase, strip code blocks, collapse whitespace
    return p.toLowerCase()
      .replace(/```[\s\S]*?```/g, "{{CODE}}")
      .replace(/\s+/g, " ")
      .trim();
  });

  // Find common prefixes (> 3 occurrences)
  const prefixes: Record<string, { count: number; examples: string[] }> = {};
  for (let i = 0; i < normalized.length; i++) {
    const words = normalized[i].split(" ").slice(0, 5).join(" ");
    if (words.length < 10) continue;
    if (!prefixes[words]) prefixes[words] = { count: 0, examples: [] };
    prefixes[words].count++;
    if (prefixes[words].examples.length < 3) {
      prefixes[words].examples.push(prompts[i]);
    }
  }

  return Object.entries(prefixes)
    .filter(([, v]) => v.count >= 3)
    .map(([pattern, v]) => ({ pattern, count: v.count, examples: v.examples }))
    .sort((a, b) => b.count - a.count);
}

// Recursive context compression (Letta-inspired)
function compressContext(messages: Array<{ role: string; content: string }>): {
  summary: string;
  keyFacts: string[];
  originalTokens: number;
  compressedTokens: number;
} {
  const fullText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const originalTokens = Math.ceil(fullText.length / 4);

  // Extract key facts using heuristics
  const keyFacts: string[] = [];
  for (const msg of messages) {
    const content = msg.content;

    // Decisions
    const decisions = content.match(/(?:decided|chose|going with|will use|switched to)\s+[^.!?]+/gi);
    if (decisions) keyFacts.push(...decisions.map((d) => d.trim()));

    // Requirements
    const reqs = content.match(/(?:must|should|need to|requires?|important)\s+[^.!?]+/gi);
    if (reqs) keyFacts.push(...reqs.slice(0, 2).map((r) => r.trim()));

    // Code/technical facts
    const tech = content.match(/(?:using|installed|configured|deployed|created|built)\s+[^.!?]+/gi);
    if (tech) keyFacts.push(...tech.slice(0, 2).map((t) => t.trim()));
  }

  // Deduplicate and limit
  const uniqueFacts = [...new Set(keyFacts)].slice(0, 20);

  // Build compressed summary
  const summary = [
    `Conversation with ${messages.length} messages.`,
    uniqueFacts.length > 0 ? `Key points: ${uniqueFacts.slice(0, 10).join("; ")}.` : "",
  ].filter(Boolean).join(" ");

  const compressedTokens = Math.ceil(summary.length / 4);

  return {
    summary,
    keyFacts: uniqueFacts,
    originalTokens,
    compressedTokens,
  };
}

// ── Mission intent detection ────────────────────────────────────────────────

const MISSION_TRIGGERS: Array<{
  pattern: RegExp;
  templateId: string;
  buildVars: (msg: string, m: RegExpMatchArray) => Record<string, string>;
}> = [
  { pattern: /\b(research|look up|find out about|investigate)\s+(.+)/i, templateId: "research-deep-dive", buildVars: (_, m) => ({ topic: m[2]?.trim() ?? "" }) },
  { pattern: /\b(write a? ?(blog|article|post) about)\s+(.+)/i, templateId: "write-blog-post", buildVars: (_, m) => ({ topic: m[3]?.trim() ?? "", audience: "general audience", length: "1000-1500 words" }) },
  { pattern: /\b(debug|fix|diagnose)\s+(?:the\s+)?(?:issue|bug|error|problem)[:\s]+(.+)/i, templateId: "debug-issue", buildVars: (_, m) => ({ issue: m[2]?.trim() ?? m[0], repo_path: "." }) },
  { pattern: /\b(analyse|analyze|compare)\s+(.+?)\s+(?:vs?\.?|versus|against)\s+(.+)/i, templateId: "competitor-analysis", buildVars: (_, m) => ({ competitor: m[2]?.trim() ?? "", product: m[3]?.trim() ?? "" }) },
  { pattern: /\b(build|implement|add)\s+(?:a\s+)?(.+?)\s+(?:feature|endpoint|component|function)/i, templateId: "code-feature", buildVars: (_, m) => ({ feature: m[2]?.trim() ?? m[0], repo_path: "." }) },
];

export function useSelfEvolution(
  allSpecs?: MissionSpec[],
  onMissionReady?: (mission: OperatorMission) => void,
) {
  const [skills, setSkills] = useState<GeneratedSkill[]>(loadSkills);
  const [optimizations] = useState<PromptOptimization[]>(loadOptimizations);
  const [compressedContexts, setCompressedContexts] = useState<CompressedContext[]>(loadCompressed);

  // Analyze conversation history to discover repeating patterns → skills
  const discoverSkills = useCallback((userPrompts: string[]) => {
    const patterns = detectPatterns(userPrompts);

    for (const pattern of patterns) {
      // Check if skill already exists
      const existing = skills.find((s) => s.trigger === pattern.pattern);
      if (existing) continue;

      const skill: GeneratedSkill = {
        id: crypto.randomUUID(),
        name: `Auto: ${pattern.pattern.slice(0, 40)}...`,
        trigger: pattern.pattern,
        template: pattern.examples[0],
        exampleInputs: pattern.examples,
        successRate: 0.5,
        usageCount: pattern.count,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        generatedFrom: "auto-discovery",
        active: true,
      };

      setSkills((prev) => {
        const next = [...prev, skill];
        saveSkills(next);
        return next;
      });
    }
  }, [skills]);

  // Compress a conversation for long-term storage
  const compressConversation = useCallback((
    messages: Array<{ role: string; content: string }>,
    conversationId: string,
  ) => {
    const result = compressContext(messages);

    const compressed: CompressedContext = {
      id: crypto.randomUUID(),
      ...result,
      conversationIds: [conversationId],
      createdAt: Date.now(),
      compressionRatio: result.compressedTokens / Math.max(result.originalTokens, 1),
    };

    setCompressedContexts((prev) => {
      const next = [...prev, compressed].slice(-100);
      saveCompressed(next);
      return next;
    });

    return compressed;
  }, []);

  // Get relevant compressed context for a new conversation
  const getCompressedContext = useCallback((query: string, maxTokens = 300): string => {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const scored = compressedContexts
      .map((ctx) => {
        const text = (ctx.summary + " " + ctx.keyFacts.join(" ")).toLowerCase();
        const score = queryTerms.filter((t) => text.includes(t)).length;
        return { ctx, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const lines: string[] = [];
    let tokens = 0;

    for (const { ctx } of scored) {
      const line = `[Past context] ${ctx.summary}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (tokens + lineTokens > maxTokens) break;
      lines.push(line);
      tokens += lineTokens;
    }

    return lines.join("\n");
  }, [compressedContexts]);

  // Find matching skills for a user input
  const matchSkills = useCallback((input: string): GeneratedSkill[] => {
    const lower = input.toLowerCase();
    return skills
      .filter((s) => s.active && lower.includes(s.trigger.slice(0, 20)))
      .sort((a, b) => b.successRate - a.successRate);
  }, [skills]);

  const updateSkillSuccess = useCallback((skillId: string, success: boolean) => {
    setSkills((prev) => {
      const next = prev.map((s) => {
        if (s.id !== skillId) return s;
        const newCount = s.usageCount + 1;
        const newRate = (s.successRate * s.usageCount + (success ? 1 : 0)) / newCount;
        return { ...s, successRate: newRate, usageCount: newCount, updatedAt: Date.now() };
      });
      saveSkills(next);
      return next;
    });
  }, []);

  const toggleSkill = useCallback((skillId: string) => {
    setSkills((prev) => {
      const next = prev.map((s) => s.id === skillId ? { ...s, active: !s.active } : s);
      saveSkills(next);
      return next;
    });
  }, []);

  const deleteSkill = useCallback((skillId: string) => {
    setSkills((prev) => {
      const next = prev.filter((s) => s.id !== skillId);
      saveSkills(next);
      return next;
    });
  }, []);

  const stats = {
    totalSkills: skills.length,
    activeSkills: skills.filter((s) => s.active).length,
    totalOptimizations: optimizations.length,
    totalCompressed: compressedContexts.length,
    avgCompressionRatio: compressedContexts.length > 0
      ? compressedContexts.reduce((s, c) => s + c.compressionRatio, 0) / compressedContexts.length
      : 0,
    tokensSaved: compressedContexts.reduce((s, c) => s + (c.originalTokens - c.compressedTokens), 0),
  };

  // ── Auto-template authoring from repeated mission patterns ────────────────

  const proposeTemplateFromMissions = useCallback(async (
    completedGoals: string[],
    onPropose: (spec: MissionSpec) => void,
  ) => {
    if (!allSpecs || completedGoals.length < 3) return;

    // Cluster goals by first 5 words (cheap n-gram similarity)
    const clusters: Record<string, string[]> = {};
    for (const goal of completedGoals) {
      const key = goal.toLowerCase().trim().split(/\s+/).slice(0, 5).join(" ");
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(goal);
    }

    for (const [key, goals] of Object.entries(clusters)) {
      if (goals.length < 3) continue;
      // Check if we already have a template for this pattern
      const exists = allSpecs.some((s) => s.title.toLowerCase().includes(key.split(" ")[0]));
      if (exists) continue;

      // Derive input var names from the goal — find the varying part
      const words = goals[0].split(/\s+/);
      const inputVars = words
        .filter((w) => w.length > 3 && /^[a-z]/i.test(w))
        .slice(0, 2)
        .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));

      const newSpec: MissionSpec = {
        id: `auto-${key.replace(/\s+/g, "-").slice(0, 30)}-${Date.now()}`,
        title: `Auto: ${goals[0].slice(0, 50)}`,
        description: `Auto-generated from ${goals.length} similar missions: ${key}…`,
        tags: ["auto-generated"],
        builtIn: false,
        inputVars: inputVars.length > 0 ? inputVars : ["goal"],
        stages: [
          {
            id: "s1",
            title: "Execute",
            goalTemplate: inputVars.length > 0
              ? goals[0].replace(new RegExp(inputVars[0], "i"), `{{${inputVars[0]}}}`)
              : `{{goal}}`,
            dependsOn: [],
            runtimeHint: "blade-native",
          },
        ],
        createdAt: new Date().toISOString(),
      };

      onPropose(newSpec);
    }
  }, [allSpecs]);

  // ── Mission-spawning capabilities ──────────────────────────────────────────

  const onMissionReadyRef = useRef(onMissionReady);
  onMissionReadyRef.current = onMissionReady;

  const detectMissionIntent = useCallback((message: string): { spec: MissionSpec; vars: Record<string, string> } | null => {
    if (!allSpecs) return null;
    for (const trigger of MISSION_TRIGGERS) {
      const match = message.match(trigger.pattern);
      if (match) {
        const spec = allSpecs.find((s) => s.id === trigger.templateId);
        if (spec) {
          const vars = trigger.buildVars(message, match);
          const hasAllVars = spec.inputVars.every((v) => !!vars[v]);
          if (hasAllVars) return { spec, vars };
        }
      }
    }
    return null;
  }, [allSpecs]);

  const spawnMission = useCallback(async (spec: MissionSpec, vars: Record<string, string>): Promise<OperatorMission> => {
    const mission = specToOperatorMission(spec, vars);
    await invoke("runtime_save_mission", { mission, autoRun: false }).catch(() => {});
    onMissionReadyRef.current?.(mission);
    return mission;
  }, []);

  const learnFromStage = useCallback(async (
    missionId: string,
    stageId: string,
    stageTitle: string,
    summary: string,
    artifactsJson = "[]",
  ) => {
    await invoke("learn_from_mission_stage", {
      missionId, stageId, stageTitle, stageSummary: summary, artifactsJson,
    }).catch(() => {});
    if (summary.length > 20) {
      await addMemory(
        `[Auto-learned] ${stageTitle}: ${summary.slice(0, 300)}`,
        missionId,
        [],
        0.75,
      ).catch(() => {});
    }
  }, []);

  const checkScheduledMissions = useCallback(async (): Promise<MissionSpec[]> => {
    try {
      return await invoke<MissionSpec[]>("get_due_scheduled_missions") ?? [];
    } catch {
      return [];
    }
  }, []);

  // Periodic scheduler poll (every 5 minutes)
  useEffect(() => {
    if (!allSpecs) return;
    const poll = async () => {
      const due = await checkScheduledMissions();
      for (const spec of due) {
        if (spec.inputVars.length === 0) {
          const mission = specToOperatorMission(spec, {});
          onMissionReadyRef.current?.(mission);
        }
      }
    };
    const timer = setInterval(() => void poll(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [allSpecs, checkScheduledMissions]);

  return {
    skills,
    optimizations,
    compressedContexts,
    discoverSkills,
    compressConversation,
    getCompressedContext,
    matchSkills,
    updateSkillSuccess,
    toggleSkill,
    deleteSkill,
    stats,
    // Mission-spawning
    detectMissionIntent,
    spawnMission,
    learnFromStage,
    checkScheduledMissions,
    proposeTemplateFromMissions,
  };
}
