import { useState, useCallback, useMemo } from "react";

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  category: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

const STORAGE_KEY = "blade-templates";

const CATEGORIES = ["coding", "writing", "analysis", "custom"] as const;
export type TemplateCategory = (typeof CATEGORIES)[number];

export function extractVariables(content: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (!vars.includes(match[1])) {
      vars.push(match[1]);
    }
  }
  return vars;
}

export function fillTemplate(
  content: string,
  values: Record<string, string>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
}

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  // Coding
  {
    id: "builtin-code-review",
    name: "Code Review",
    content:
      "Review this code for bugs, performance, and best practices:\n\n{{code}}",
    variables: ["code"],
    category: "coding",
    icon: "\uD83D\uDD0D",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-debug-error",
    name: "Debug Error",
    content:
      "Debug this error. Explain the cause and suggest a fix:\n\n{{error}}",
    variables: ["error"],
    category: "coding",
    icon: "\uD83D\uDC1B",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-write-tests",
    name: "Write Tests",
    content: "Write comprehensive tests for:\n\n{{code}}",
    variables: ["code"],
    category: "coding",
    icon: "\u2705",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-refactor",
    name: "Refactor",
    content:
      "Refactor this code to be cleaner and more maintainable:\n\n{{code}}",
    variables: ["code"],
    category: "coding",
    icon: "\u267B\uFE0F",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  // Writing
  {
    id: "builtin-proofread",
    name: "Proofread",
    content:
      "Proofread and improve this text. Fix grammar, clarity, and tone:\n\n{{text}}",
    variables: ["text"],
    category: "writing",
    icon: "\u270F\uFE0F",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-summarize",
    name: "Summarize",
    content: "Summarize the key points of:\n\n{{text}}",
    variables: ["text"],
    category: "writing",
    icon: "\uD83D\uDCCB",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-email-draft",
    name: "Email Draft",
    content:
      "Write a professional email about:\n\nContext: {{context}}\nTone: {{tone}}",
    variables: ["context", "tone"],
    category: "writing",
    icon: "\uD83D\uDCE7",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  // Analysis
  {
    id: "builtin-explain-concept",
    name: "Explain Concept",
    content:
      "Explain {{concept}} in simple terms. Include examples and analogies.",
    variables: ["concept"],
    category: "analysis",
    icon: "\uD83D\uDCA1",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-compare-options",
    name: "Compare Options",
    content:
      "Compare these options and recommend the best choice:\n\n{{options}}",
    variables: ["options"],
    category: "analysis",
    icon: "\u2696\uFE0F",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-pros-and-cons",
    name: "Pros and Cons",
    content: "List the pros and cons of {{topic}}",
    variables: ["topic"],
    category: "analysis",
    icon: "\uD83D\uDCCA",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  // Custom
  {
    id: "builtin-custom-prompt",
    name: "Custom Prompt",
    content: "{{prompt}}",
    variables: ["prompt"],
    category: "custom",
    icon: "\u2728",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
  {
    id: "builtin-translate",
    name: "Translate",
    content: "Translate to {{language}}:\n\n{{text}}",
    variables: ["language", "text"],
    category: "custom",
    icon: "\uD83C\uDF10",
    createdAt: 0,
    updatedAt: 0,
    usageCount: 0,
  },
];

function loadUserTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore corrupt data
  }
  return [];
}

function saveUserTemplates(templates: PromptTemplate[]): void {
  const userOnly = templates.filter((t) => !t.id.startsWith("builtin-"));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userOnly));
}

function loadUsageCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "-usage");
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveUsageCounts(counts: Record<string, number>): void {
  localStorage.setItem(STORAGE_KEY + "-usage", JSON.stringify(counts));
}

export function mergeTemplates(
  usageCounts: Record<string, number>
): PromptTemplate[] {
  const builtins = BUILTIN_TEMPLATES.map((t) => ({
    ...t,
    usageCount: usageCounts[t.id] ?? 0,
  }));
  const userTemplates = loadUserTemplates().map((t) => ({
    ...t,
    usageCount: usageCounts[t.id] ?? t.usageCount,
  }));
  return [...builtins, ...userTemplates];
}

function generateId(): string {
  return "tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function useTemplates() {
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>(
    loadUsageCounts
  );
  const [userTemplates, setUserTemplates] = useState<PromptTemplate[]>(
    loadUserTemplates
  );

  const templates = useMemo(() => {
    const builtins = BUILTIN_TEMPLATES.map((t) => ({
      ...t,
      usageCount: usageCounts[t.id] ?? 0,
    }));
    const withUsage = userTemplates.map((t) => ({
      ...t,
      usageCount: usageCounts[t.id] ?? t.usageCount,
    }));
    return [...builtins, ...withUsage];
  }, [userTemplates, usageCounts]);

  const categories = CATEGORIES;

  const addTemplate = useCallback(
    (
      name: string,
      content: string,
      category: string,
      icon: string
    ): PromptTemplate => {
      const now = Date.now();
      const template: PromptTemplate = {
        id: generateId(),
        name,
        content,
        variables: extractVariables(content),
        category,
        icon: icon || "\uD83D\uDCDD",
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      };
      setUserTemplates((prev) => {
        const next = [...prev, template];
        saveUserTemplates(next);
        return next;
      });
      return template;
    },
    []
  );

  const updateTemplate = useCallback(
    (
      id: string,
      updates: Partial<Pick<PromptTemplate, "name" | "content" | "category" | "icon">>
    ) => {
      if (id.startsWith("builtin-")) return;
      setUserTemplates((prev) => {
        const next = prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...updates, updatedAt: Date.now() };
          if (updates.content !== undefined) {
            updated.variables = extractVariables(updates.content);
          }
          return updated;
        });
        saveUserTemplates(next);
        return next;
      });
    },
    []
  );

  const deleteTemplate = useCallback((id: string) => {
    if (id.startsWith("builtin-")) return;
    setUserTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveUserTemplates(next);
      return next;
    });
  }, []);

  const getTemplate = useCallback(
    (id: string): PromptTemplate | undefined => {
      return templates.find((t) => t.id === id);
    },
    [templates]
  );

  const incrementUsage = useCallback((id: string) => {
    setUsageCounts((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
      saveUsageCounts(next);
      return next;
    });
  }, []);

  const searchTemplates = useCallback(
    (query: string): PromptTemplate[] => {
      if (!query.trim()) return templates;
      const lower = query.toLowerCase();
      const terms = lower.split(/\s+/).filter(Boolean);
      return templates.filter((t) => {
        const haystack = `${t.name} ${t.content} ${t.category}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    },
    [templates]
  );

  return {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplate,
    categories,
    incrementUsage,
    searchTemplates,
  };
}
