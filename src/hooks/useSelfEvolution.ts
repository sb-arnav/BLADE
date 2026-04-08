import { useState, useCallback } from "react";

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

export function useSelfEvolution() {
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
  };
}
