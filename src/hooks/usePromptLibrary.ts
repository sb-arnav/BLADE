import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  category: "coding" | "writing" | "analysis" | "creative" | "productivity" | "custom";
  tags: string[];
  usageCount: number;
  rating: number;
  lastUsed: number | null;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  source: "manual" | "history" | "community";
  variables: string[];
}

export interface PromptHistory {
  id: string;
  prompt: string;
  response: string;
  model: string;
  provider: string;
  timestamp: number;
  rating: number | null;
  saved: boolean;
}

export type PromptCategory = SavedPrompt["category"];
export type SortMode = "most-used" | "highest-rated" | "newest" | "alphabetical";

export interface PromptLibraryStats {
  totalPrompts: number;
  totalHistory: number;
  byCategory: Record<string, number>;
  avgRating: number;
  totalUsage: number;
  topTags: { tag: string; count: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────

const LIBRARY_KEY = "blade-prompt-library";
const HISTORY_KEY = "blade-prompt-history";
const MAX_HISTORY = 200;

const CATEGORIES: PromptCategory[] = [
  "coding", "writing", "analysis", "creative", "productivity", "custom",
];

// ── Helpers ────────────────────────────────────────────────────────────

export function extractVariables(content: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (!vars.includes(match[1])) vars.push(match[1]);
  }
  return vars;
}

export function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Built-in Community Prompts ─────────────────────────────────────────

const COMMUNITY_PROMPTS: SavedPrompt[] = [
  {
    id: "community-code-review",
    title: "Expert Code Review",
    content: "You are a senior software engineer performing a thorough code review. Analyze the following code for:\n1. Bugs and edge cases\n2. Performance bottlenecks\n3. Security vulnerabilities\n4. Code style and best practices\n5. Suggestions for improvement\n\nProvide specific line references and severity ratings.\n\n```{{language}}\n{{code}}\n```",
    category: "coding",
    tags: ["review", "quality", "best-practices"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["language", "code"],
  },
  {
    id: "community-bug-analyzer",
    title: "Bug Report Analyzer",
    content: "Analyze this bug report systematically:\n\nBug Report:\n{{bug_report}}\n\nProvide:\n1. Root cause analysis\n2. Steps to reproduce (refined)\n3. Impact assessment (severity, affected users)\n4. Suggested fix approach\n5. Regression test recommendations\n6. Related areas that might be affected",
    category: "coding",
    tags: ["debugging", "bug", "analysis"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["bug_report"],
  },
  {
    id: "community-api-design",
    title: "API Design",
    content: "Design a {{api_type}} API for {{domain}}.\n\nRequirements:\n{{requirements}}\n\nInclude:\n1. Endpoint/query definitions with request/response schemas\n2. Authentication and authorization strategy\n3. Error handling patterns\n4. Pagination approach\n5. Rate limiting considerations\n6. Versioning strategy\n7. Example requests and responses",
    category: "coding",
    tags: ["api", "rest", "graphql", "design"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["api_type", "domain", "requirements"],
  },
  {
    id: "community-db-schema",
    title: "Database Schema",
    content: "Design a SQL database schema for {{application}}.\n\nEntities and relationships:\n{{entities}}\n\nInclude:\n1. Table definitions with appropriate data types\n2. Primary and foreign keys\n3. Indexes for common query patterns\n4. Constraints and validations\n5. Migration strategy\n6. Sample queries for key operations",
    category: "coding",
    tags: ["database", "sql", "schema", "design"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["application", "entities"],
  },
  {
    id: "community-regex-builder",
    title: "Regex Builder",
    content: "Build a regular expression that matches: {{pattern_description}}\n\nProvide:\n1. The regex pattern\n2. Step-by-step explanation of each part\n3. Test cases that should match\n4. Test cases that should NOT match\n5. Edge cases to consider\n6. Alternative approaches if applicable\n\nLanguage/flavor: {{language}}",
    category: "coding",
    tags: ["regex", "pattern", "validation"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["pattern_description", "language"],
  },
  {
    id: "community-git-commit",
    title: "Git Commit Message",
    content: "Generate a conventional commit message for the following changes:\n\n{{diff}}\n\nFollow the format: type(scope): description\n\nTypes: feat, fix, docs, style, refactor, perf, test, chore\nInclude a body explaining WHY the change was made if non-trivial.\nAdd BREAKING CHANGE footer if applicable.",
    category: "coding",
    tags: ["git", "commit", "conventional"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["diff"],
  },
  {
    id: "community-unit-tests",
    title: "Unit Test Writer",
    content: "Write comprehensive unit tests for the following {{language}} code using {{framework}}:\n\n```{{language}}\n{{code}}\n```\n\nInclude:\n1. Happy path tests\n2. Edge cases and boundary values\n3. Error/exception scenarios\n4. Mock/stub setup where needed\n5. Descriptive test names following AAA pattern (Arrange, Act, Assert)",
    category: "coding",
    tags: ["testing", "unit-test", "tdd"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["language", "framework", "code"],
  },
  {
    id: "community-refactoring",
    title: "Refactoring Guide",
    content: "Refactor this code systematically:\n\n```{{language}}\n{{code}}\n```\n\nGoals: {{goals}}\n\nProvide:\n1. Identify code smells and anti-patterns\n2. Step-by-step refactoring plan\n3. Refactored code with explanations\n4. Before/after comparison of key metrics\n5. Tests to verify behavior is preserved",
    category: "coding",
    tags: ["refactoring", "clean-code", "patterns"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["language", "code", "goals"],
  },
  {
    id: "community-adr",
    title: "Architecture Decision Record",
    content: "Create an Architecture Decision Record (ADR) for:\n\nDecision: {{decision}}\nContext: {{context}}\n\nFormat:\n# ADR-XXX: {{decision}}\n## Status: Proposed\n## Context\n## Decision\n## Consequences (positive, negative, risks)\n## Alternatives Considered\n## References",
    category: "coding",
    tags: ["architecture", "documentation", "adr"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["decision", "context"],
  },
  {
    id: "community-meeting-notes",
    title: "Meeting Notes",
    content: "Organize these raw meeting notes into a structured summary:\n\n{{raw_notes}}\n\nFormat as:\n1. Meeting title and date\n2. Attendees\n3. Key discussion points (bulleted)\n4. Decisions made\n5. Action items (owner + deadline)\n6. Open questions\n7. Next meeting date/agenda",
    category: "productivity",
    tags: ["meeting", "notes", "summary"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["raw_notes"],
  },
  {
    id: "community-email-pro",
    title: "Email Professional",
    content: "Write a professional email:\n\nPurpose: {{purpose}}\nRecipient: {{recipient}}\nTone: {{tone}}\nKey points: {{key_points}}\n\nMake it concise, clear, and actionable. Include a compelling subject line.",
    category: "writing",
    tags: ["email", "professional", "communication"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["purpose", "recipient", "tone", "key_points"],
  },
  {
    id: "community-blog-outline",
    title: "Blog Outline",
    content: "Create a structured blog post outline:\n\nTopic: {{topic}}\nTarget audience: {{audience}}\nGoal: {{goal}}\n\nInclude:\n1. Attention-grabbing title options (3)\n2. Introduction hook\n3. Main sections with key points\n4. Code examples or data points to include\n5. Conclusion and call to action\n6. SEO keywords",
    category: "writing",
    tags: ["blog", "content", "outline"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["topic", "audience", "goal"],
  },
  {
    id: "community-eli5",
    title: "Explain Like I'm 5",
    content: "Explain {{concept}} in the simplest possible terms.\n\nUse:\n- Everyday analogies\n- Short sentences\n- No jargon\n- A fun example\n- A one-sentence summary at the end\n\nTarget understanding level: {{level}}",
    category: "creative",
    tags: ["explain", "simple", "teaching"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["concept", "level"],
  },
  {
    id: "community-pros-cons",
    title: "Pros and Cons",
    content: "Provide a balanced analysis of pros and cons for:\n\n{{topic}}\n\nContext: {{context}}\n\nFormat as a table with:\n- Pros (with impact rating: high/medium/low)\n- Cons (with impact rating: high/medium/low)\n- Overall recommendation with reasoning",
    category: "analysis",
    tags: ["analysis", "comparison", "decision"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["topic", "context"],
  },
  {
    id: "community-swot",
    title: "SWOT Analysis",
    content: "Perform a SWOT analysis for:\n\nSubject: {{subject}}\nIndustry/Context: {{industry}}\n\nAnalyze:\n- Strengths (internal positives)\n- Weaknesses (internal negatives)\n- Opportunities (external positives)\n- Threats (external negatives)\n\nProvide 4-6 points per category with actionable insights.",
    category: "analysis",
    tags: ["swot", "business", "strategy"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["subject", "industry"],
  },
  {
    id: "community-user-story",
    title: "User Story",
    content: "Write agile user stories for:\n\nFeature: {{feature}}\nProduct: {{product}}\n\nFormat each as:\n- As a [user type], I want to [action] so that [benefit]\n- Acceptance criteria (Given/When/Then)\n- Story points estimate\n- Priority (MoSCoW)\n- Dependencies",
    category: "productivity",
    tags: ["agile", "user-story", "scrum"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["feature", "product"],
  },
  {
    id: "community-interview-questions",
    title: "Interview Questions",
    content: "Generate technical interview questions for a {{role}} position.\n\nFocus areas: {{focus_areas}}\nDifficulty: {{difficulty}}\n\nFor each question provide:\n1. The question\n2. What it evaluates\n3. Key points in an ideal answer\n4. Follow-up questions\n5. Red flags in answers",
    category: "productivity",
    tags: ["interview", "hiring", "technical"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["role", "focus_areas", "difficulty"],
  },
  {
    id: "community-learning-roadmap",
    title: "Learning Roadmap",
    content: "Create a learning roadmap for {{topic}}.\n\nCurrent level: {{current_level}}\nGoal: {{goal}}\nTime available: {{timeframe}}\n\nInclude:\n1. Prerequisites\n2. Week-by-week plan\n3. Key resources (free and paid)\n4. Practice projects for each stage\n5. Milestones and checkpoints\n6. Common pitfalls to avoid",
    category: "creative",
    tags: ["learning", "roadmap", "education"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["topic", "current_level", "goal", "timeframe"],
  },
  {
    id: "community-changelog",
    title: "Changelog Generator",
    content: "Generate a changelog entry from these changes:\n\n{{changes}}\n\nVersion: {{version}}\n\nFormat using Keep a Changelog style:\n## [{{version}}] - YYYY-MM-DD\n### Added\n### Changed\n### Deprecated\n### Removed\n### Fixed\n### Security\n\nWrite user-friendly descriptions, not commit messages.",
    category: "coding",
    tags: ["changelog", "release", "documentation"],
    usageCount: 0, rating: 4, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["changes", "version"],
  },
  {
    id: "community-security-review",
    title: "Security Review",
    content: "Perform a security audit on the following code/system:\n\n{{target}}\n\nCheck for:\n1. OWASP Top 10 vulnerabilities\n2. Input validation and sanitization\n3. Authentication/authorization flaws\n4. Data exposure risks\n5. Injection vulnerabilities\n6. Dependency vulnerabilities\n7. Configuration issues\n\nRate each finding: Critical / High / Medium / Low\nProvide remediation steps for each.",
    category: "coding",
    tags: ["security", "audit", "owasp"],
    usageCount: 0, rating: 5, lastUsed: null, createdAt: 0, updatedAt: 0,
    isPublic: true, source: "community", variables: ["target"],
  },
];

// ── Persistence ───────────────────────────────────────────────────────

function loadLibrary(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

function saveLibrary(prompts: SavedPrompt[]): void {
  const userOnly = prompts.filter((p) => !p.id.startsWith("community-"));
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(userOnly));
}

function loadHistory(): PromptHistory[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory(history: PromptHistory[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

// ── Hook ──────────────────────────────────────────────────────────────

export function usePromptLibrary() {
  const [userPrompts, setUserPrompts] = useState<SavedPrompt[]>(loadLibrary);
  const [history, setHistory] = useState<PromptHistory[]>(loadHistory);

  // Merge community + user prompts
  const prompts = useMemo<SavedPrompt[]>(() => {
    return [...COMMUNITY_PROMPTS, ...userPrompts];
  }, [userPrompts]);

  // Persist on change
  useEffect(() => { saveLibrary(userPrompts); }, [userPrompts]);
  useEffect(() => { saveHistory(history); }, [history]);

  // ── Prompt CRUD ─────────────────────────────────────────────────────

  const addPrompt = useCallback(
    (partial: Pick<SavedPrompt, "title" | "content" | "category"> & Partial<SavedPrompt>): SavedPrompt => {
      const now = Date.now();
      const prompt: SavedPrompt = {
        id: generateId("prm"),
        tags: [],
        usageCount: 0,
        rating: 0,
        lastUsed: null,
        createdAt: now,
        updatedAt: now,
        isPublic: false,
        source: "manual",
        variables: extractVariables(partial.content),
        ...partial,
      };
      setUserPrompts((prev) => [prompt, ...prev]);
      return prompt;
    },
    [],
  );

  const updatePrompt = useCallback((id: string, changes: Partial<SavedPrompt>) => {
    if (id.startsWith("community-")) return;
    setUserPrompts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, ...changes, updatedAt: Date.now() };
        if (changes.content !== undefined) {
          updated.variables = extractVariables(changes.content);
        }
        return updated;
      }),
    );
  }, []);

  const deletePrompt = useCallback((id: string) => {
    if (id.startsWith("community-")) return;
    setUserPrompts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const ratePrompt = useCallback((id: string, rating: number) => {
    const clamped = Math.max(1, Math.min(5, rating));
    if (id.startsWith("community-")) return;
    setUserPrompts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rating: clamped, updatedAt: Date.now() } : p)),
    );
  }, []);

  const usePrompt = useCallback((id: string) => {
    const update = (p: SavedPrompt): SavedPrompt =>
      p.id === id ? { ...p, usageCount: p.usageCount + 1, lastUsed: Date.now() } : p;

    if (id.startsWith("community-")) {
      // Track community usage in user storage
      setUserPrompts((prev) => {
        const existing = prev.find((p) => p.id === id);
        if (existing) return prev.map(update);
        const community = COMMUNITY_PROMPTS.find((p) => p.id === id);
        if (!community) return prev;
        return [...prev, { ...community, usageCount: 1, lastUsed: Date.now() }];
      });
    } else {
      setUserPrompts((prev) => prev.map(update));
    }
  }, []);

  // ── Search & Filter ─────────────────────────────────────────────────

  const searchPrompts = useCallback(
    (query: string): SavedPrompt[] => {
      if (!query.trim()) return prompts;
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return prompts.filter((p) => {
        const haystack = `${p.title} ${p.content} ${p.category} ${p.tags.join(" ")}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      });
    },
    [prompts],
  );

  const getByCategory = useCallback(
    (category: PromptCategory): SavedPrompt[] => {
      return prompts.filter((p) => p.category === category);
    },
    [prompts],
  );

  const getTopPrompts = useCallback(
    (limit = 10): SavedPrompt[] => {
      return [...prompts]
        .sort((a, b) => b.usageCount - a.usageCount || b.rating - a.rating)
        .slice(0, limit);
    },
    [prompts],
  );

  // ── History ─────────────────────────────────────────────────────────

  const addToHistory = useCallback(
    (entry: Omit<PromptHistory, "id" | "timestamp" | "rating" | "saved">): PromptHistory => {
      const item: PromptHistory = {
        id: generateId("hist"),
        timestamp: Date.now(),
        rating: null,
        saved: false,
        ...entry,
      };
      setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY));
      return item;
    },
    [],
  );

  const rateHistoryItem = useCallback((id: string, rating: number) => {
    const clamped = Math.max(1, Math.min(5, rating));
    setHistory((prev) =>
      prev.map((h) => (h.id === id ? { ...h, rating: clamped } : h)),
    );
  }, []);

  const saveFromHistory = useCallback(
    (historyId: string, title: string, category: PromptCategory, tags: string[] = []): SavedPrompt | null => {
      const item = history.find((h) => h.id === historyId);
      if (!item) return null;

      const prompt = addPrompt({
        title,
        content: item.prompt,
        category,
        tags,
        source: "history",
        rating: item.rating ?? 0,
      });

      setHistory((prev) =>
        prev.map((h) => (h.id === historyId ? { ...h, saved: true } : h)),
      );

      return prompt;
    },
    [history, addPrompt],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // ── Stats ───────────────────────────────────────────────────────────

  const stats: PromptLibraryStats = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    let totalRating = 0;
    let ratedCount = 0;
    let totalUsage = 0;

    for (const p of prompts) {
      byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
      totalUsage += p.usageCount;
      if (p.rating > 0) {
        totalRating += p.rating;
        ratedCount++;
      }
      for (const tag of p.tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPrompts: prompts.length,
      totalHistory: history.length,
      byCategory,
      avgRating: ratedCount > 0 ? totalRating / ratedCount : 0,
      totalUsage,
      topTags,
    };
  }, [prompts, history]);

  return {
    prompts,
    history,
    categories: CATEGORIES,
    addPrompt,
    updatePrompt,
    deletePrompt,
    ratePrompt,
    usePrompt,
    searchPrompts,
    getByCategory,
    addToHistory,
    rateHistoryItem,
    saveFromHistory,
    clearHistory,
    getTopPrompts,
    stats,
  };
}
